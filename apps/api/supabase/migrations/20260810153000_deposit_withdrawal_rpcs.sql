-- record_deposit: service_role-only, called exclusively by the trusted
-- Stripe webhook handler (Task 12) on payment_intent.succeeded. The
-- caller itself is always trusted (never an untrusted end user), so this
-- does NOT need record_withdrawal's full ownership check (no auth.uid()
-- to check against — service_role has none) or its unique_violation race
-- recovery (webhook retries handle races fine on their own, and Stripe
-- delivers the same event id sequentially in practice). It DOES need the
-- type-binding half of the pattern (Fix Round 1 finding, reviewer-
-- verified live): p_idempotency_key is caller-chosen text accepted
-- verbatim by record_withdrawal and transfer_funds too, and both of
-- those are reachable by any `authenticated` end user. A user who learns
-- or predicts their own future Stripe PaymentIntent id could pre-plant
-- it as the idempotency_key of their own record_withdrawal/transfer_funds
-- call; when the real deposit webhook later fires with that same key,
-- record_deposit would otherwise see the bare key match and return
-- "already_processed" without ever crediting the account — a silent lost
-- deposit. Requiring the existing transaction to actually be a 'deposit'
-- with a matching credit ledger_entries row on p_account_id closes that:
-- a mismatched match now raises loudly (23505), which is the correct
-- webhook-handler behavior (Stripe sees an error and retries/alerts
-- rather than the deposit silently vanishing).
create or replace function public.record_deposit(
  p_account_id uuid,
  p_amount_cents bigint,
  p_stripe_reference text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance bigint;
  v_transaction_id uuid;
  v_existing_transaction_id uuid;
begin
  if p_amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  select id into v_existing_transaction_id from public.transactions where idempotency_key = p_idempotency_key;
  if v_existing_transaction_id is not null then
    if exists (
      select 1 from public.ledger_entries le
      join public.transactions t on t.id = le.transaction_id
      where le.transaction_id = v_existing_transaction_id
        and le.account_id = p_account_id
        and le.direction = 'credit'
        and t.type = 'deposit'
    ) then
      return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
    else
      raise exception 'idempotency key already used for a different transaction' using errcode = '23505';
    end if;
  end if;

  perform 1 from public.accounts where id = p_account_id for update;

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_balance
  from public.ledger_entries where account_id = p_account_id;

  insert into public.transactions (type, status, stripe_reference, idempotency_key)
  values ('deposit', 'completed', p_stripe_reference, p_idempotency_key)
  returning id into v_transaction_id;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (p_account_id, v_transaction_id, p_amount_cents, 'credit', v_balance + p_amount_cents);

  return jsonb_build_object('transaction_id', v_transaction_id, 'status', 'completed');
end;
$$;

revoke execute on function public.record_deposit(uuid, bigint, text, text) from public, authenticated, anon;
grant execute on function public.record_deposit(uuid, bigint, text, text) to service_role;

-- record_withdrawal: callable directly by `authenticated` users (own
-- account inferred from auth.uid()) — the same threat model as Task 5's
-- transfer_funds. Applies the same idempotency-key hardening that
-- transfer_funds needed after its own review round (see
-- 20260810115239_transfer_funds_rpc.sql), proactively, with one
-- additional refinement: the ownership check is also bound to the
-- transaction *type* ('withdrawal'), not just to the caller's own
-- account + debit direction. This matters specifically because
-- transactions.idempotency_key is globally unique across every RPC that
-- writes a transaction row (record_deposit, transfer_funds, and this
-- function all share it), so a debit-direction-only check could let a
-- withdrawal's key accidentally satisfy a transfer's replay-check (or
-- vice versa) for the same user/account, silently reporting the wrong
-- transaction as "already processed" instead of surfacing the collision.
create or replace function public.record_withdrawal(
  p_amount_cents bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_balance bigint;
  v_kyc_status text;
  v_prior_withdrawn bigint;
  v_transaction_id uuid;
  v_existing_transaction_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if coalesce((auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception 'mfa verification required' using errcode = '28000';
  end if;

  if p_amount_cents <= 0 then
    raise exception 'amount must be positive' using errcode = '22023';
  end if;

  -- Resolved before the idempotency check (unlike the brief's original
  -- ordering) because the ownership check below needs to know the
  -- caller's own account id.
  select a.id, p.kyc_status into v_account_id, v_kyc_status
  from public.accounts a
  join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid();

  if v_account_id is null then
    raise exception 'account not found' using errcode = 'P0002';
  end if;

  -- Idempotency check #1 (pre-lock fast path): idempotency_key is
  -- globally unique across ALL transaction types, so a bare key match is
  -- not by itself proof the caller owns that transaction, nor that it's
  -- even the same *kind* of operation. Only treat it as "already
  -- processed" if the caller's own account has a debit ledger entry for
  -- it AND the transaction itself is a withdrawal; otherwise this is a
  -- key collision (a different user's transaction, or this same user's
  -- own transfer_funds/deposit call that happened to reuse the key),
  -- which must fail loudly rather than silently reporting fake success
  -- or returning an unrelated transaction's status as if it were this
  -- withdrawal's.
  select id into v_existing_transaction_id
  from public.transactions
  where idempotency_key = p_idempotency_key;

  if v_existing_transaction_id is not null then
    if exists (
      select 1 from public.ledger_entries le
      join public.transactions t on t.id = le.transaction_id
      where le.transaction_id = v_existing_transaction_id
        and le.account_id = v_account_id
        and le.direction = 'debit'
        and t.type = 'withdrawal'
    ) then
      return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
    else
      raise exception 'idempotency key already used for a different transaction' using errcode = '23505';
    end if;
  end if;

  -- Row lock FIRST, then the KYC-cap check — Fix Round 1 finding
  -- (reviewer-verified live): the cap check previously ran before this
  -- lock, so N concurrent withdrawal requests on the same account each
  -- computed v_prior_withdrawn from the pre-lock committed state and
  -- could each independently pass "prior + this <= 10000", jointly
  -- withdrawing far more than the $100 pre-KYC cap allows. Locking the
  -- account row first serializes concurrent callers the same way it
  -- already serializes the balance check below: the second caller blocks
  -- until the first's transaction (and its withdrawal insert) commits,
  -- then re-reads a prior-withdrawn total that includes it.
  perform 1 from public.accounts where id = v_account_id for update;

  if v_kyc_status <> 'verified' then
    select coalesce(sum(le.amount_cents), 0) into v_prior_withdrawn
    from public.ledger_entries le
    join public.transactions t on t.id = le.transaction_id
    where le.account_id = v_account_id
      and t.type = 'withdrawal'
      and t.status in ('pending', 'completed')
      -- Defense in depth (reviewer's Minor #6): scope the sum to debit
      -- entries only. Every current writer only ever inserts a debit
      -- ledger_entries row against a 'pending'/'completed' withdrawal
      -- transaction (reverse_withdrawal's credit-back also flips the
      -- transaction's status to 'reversed' in the same call, which the
      -- status filter above already excludes) — but this keeps the sum
      -- correct even if that ever changes, rather than silently
      -- over-counting a future credit as more withdrawn.
      and le.direction = 'debit';

    if v_prior_withdrawn + p_amount_cents > 10000 then
      raise exception 'kyc verification required for this withdrawal amount' using errcode = '28000';
    end if;
  end if;

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_balance
  from public.ledger_entries where account_id = v_account_id;

  if v_balance < p_amount_cents then
    raise exception 'insufficient balance' using errcode = '23514';
  end if;

  -- Idempotency check #2 (race recovery): check #1 above ran before the
  -- row lock, so two truly concurrent calls with the identical key can
  -- both pass it and race to insert. The loser hits the unique
  -- constraint on transactions.idempotency_key. plpgsql's EXCEPTION
  -- clause implicitly opens a subtransaction (savepoint), so catching
  -- unique_violation here rolls back only this insert attempt, not the
  -- whole function call — letting us recover by re-running the same
  -- ownership-and-type-checked lookup as check #1 and returning the
  -- correct outcome instead of surfacing a raw 23505 to a legitimate
  -- retry.
  begin
    insert into public.transactions (type, status, initiated_by, idempotency_key)
    values ('withdrawal', 'pending', auth.uid(), p_idempotency_key)
    returning id into v_transaction_id;
  exception
    when unique_violation then
      select id into v_existing_transaction_id
      from public.transactions
      where idempotency_key = p_idempotency_key;

      if exists (
        select 1 from public.ledger_entries le
        join public.transactions t on t.id = le.transaction_id
        where le.transaction_id = v_existing_transaction_id
          and le.account_id = v_account_id
          and le.direction = 'debit'
          and t.type = 'withdrawal'
      ) then
        return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
      else
        raise exception 'idempotency key already used for a different transaction' using errcode = '23505';
      end if;
  end;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (v_account_id, v_transaction_id, p_amount_cents, 'debit', v_balance - p_amount_cents);

  return jsonb_build_object('transaction_id', v_transaction_id, 'status', 'pending', 'account_id', v_account_id);
end;
$$;

revoke execute on function public.record_withdrawal(bigint, text) from public;
grant execute on function public.record_withdrawal(bigint, text) to authenticated;

create or replace function public.confirm_withdrawal(
  p_transaction_id uuid,
  p_stripe_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.transactions
  set status = 'completed', stripe_reference = p_stripe_reference, updated_at = now()
  where id = p_transaction_id and type = 'withdrawal' and status = 'pending';

  if not found then
    raise exception 'no matching pending withdrawal transaction' using errcode = 'P0002';
  end if;

  return jsonb_build_object('transaction_id', p_transaction_id, 'status', 'completed');
end;
$$;

revoke execute on function public.confirm_withdrawal(uuid, text) from public, authenticated, anon;
grant execute on function public.confirm_withdrawal(uuid, text) to service_role;

create or replace function public.reverse_withdrawal(
  p_transaction_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_amount_cents bigint;
  v_balance bigint;
  v_initiated_by uuid;
begin
  -- This initial SELECT resolves v_account_id/v_amount_cents/v_initiated_by
  -- only — its `t.status = 'pending'` condition was removed (Fix Round 1,
  -- Critical finding, reviewer-verified live): it is a plain, unlocked
  -- read, so it is NOT a safety check against concurrent reversal. Two
  -- (or N) truly concurrent calls on the same withdrawal could all read
  -- "pending" here before any of them commits anything. The actual
  -- concurrency gate is the guarded UPDATE below, after the account lock.
  select le.account_id, le.amount_cents, t.initiated_by
  into v_account_id, v_amount_cents, v_initiated_by
  from public.ledger_entries le
  join public.transactions t on t.id = le.transaction_id
  where le.transaction_id = p_transaction_id and t.type = 'withdrawal'
  limit 1;

  if v_account_id is null then
    raise exception 'no matching pending withdrawal transaction' using errcode = 'P0002';
  end if;

  -- A real user session (auth.uid() is set) may only reverse/cancel their
  -- own pending withdrawal — this covers a synchronous Stripe payout
  -- failure inside the withdraw server action. A service-role call (no
  -- auth.uid(), i.e. the webhook) may reverse any pending withdrawal —
  -- this covers an async payout.failed event arriving later.
  -- `is distinct from` (not `<>`) because v_initiated_by can legitimately
  -- be NULL (a service-role-inserted withdrawal with no initiating user);
  -- `<>` against NULL evaluates to NULL, not TRUE, so it would silently
  -- fail to raise and let any authenticated caller reverse it (Fix
  -- Round 1, Minor finding).
  if auth.uid() is not null and auth.uid() is distinct from v_initiated_by then
    raise exception 'not authorized to reverse this transaction' using errcode = '42501';
  end if;

  perform 1 from public.accounts where id = v_account_id for update;

  -- Concurrency gate (Fix Round 1, Critical finding, reviewer-verified
  -- live): this guarded UPDATE — not the initial SELECT above — is what
  -- makes reverse_withdrawal safe under concurrency. UPDATE takes a
  -- row-level lock on the transactions row it targets, so N concurrent
  -- reverse_withdrawal calls on the same p_transaction_id serialize on
  -- it: only the first can actually flip 'pending' -> 'reversed' and
  -- proceed to credit the account; every other caller (whether truly
  -- concurrent, or running after the first has already fully committed)
  -- finds 0 rows updated and raises cleanly instead of inserting a
  -- duplicate credit. The same row-level locking also makes this safe
  -- against a concurrent confirm_withdrawal call, which has an
  -- equivalent guarded UPDATE on the same row — whichever of the two
  -- commits first wins, and the other's guarded UPDATE then correctly
  -- sees the already-changed status and raises, instead of one call
  -- reporting the payout sent and the other crediting the money back on
  -- top of it.
  update public.transactions
  set status = 'reversed', updated_at = now()
  where id = p_transaction_id and type = 'withdrawal' and status = 'pending';

  if not found then
    raise exception 'no matching pending withdrawal transaction' using errcode = 'P0002';
  end if;

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_balance
  from public.ledger_entries where account_id = v_account_id;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (v_account_id, p_transaction_id, v_amount_cents, 'credit', v_balance + v_amount_cents);

  insert into public.audit_log (action, target_table, target_id, metadata)
  values ('withdrawal_reversed', 'transactions', p_transaction_id::text, jsonb_build_object('reason', p_reason));

  return jsonb_build_object('transaction_id', p_transaction_id, 'status', 'reversed');
end;
$$;

revoke execute on function public.reverse_withdrawal(uuid, text) from public;
grant execute on function public.reverse_withdrawal(uuid, text) to authenticated, service_role;
