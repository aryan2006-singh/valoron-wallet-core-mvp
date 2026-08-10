-- Forward-fix for Task 5's already-committed transfer_funds
-- (20260810115239_transfer_funds_rpc.sql), found by Task 6's Fix Round 1
-- review (reviewer-verified live) and NOT edited in place, to preserve
-- migration history integrity — same pattern already used for the Task 4
-- audit-trigger bugfix (20260810120332_fix_audit_trigger_ledger_entries.sql).
--
-- Bug: transfer_funds's idempotency-key ownership check (added in Task 5's
-- own Fix Round 1) verifies the existing transaction has a debit
-- ledger_entries row on the caller's own sender account, but does not
-- also require that transaction's type to be 'p2p_transfer'. Since
-- transactions.idempotency_key is globally unique across every RPC that
-- writes a transaction row (record_deposit, record_withdrawal,
-- transfer_funds all share it), a caller-chosen key that was already used
-- for a record_withdrawal call by the same user (also a debit against the
-- same sender account) would satisfy this check by accident: calling
-- transfer_funds with that same key would silently return
-- {status: 'already_processed', transaction_id: <the withdrawal's id>}
-- instead of performing the transfer or rejecting the collision -- the
-- transfer silently no-ops and the intended recipient never receives
-- anything. This is the same class of gap already fixed properly in
-- record_withdrawal's own ownership check (see
-- 20260810153000_deposit_withdrawal_rpcs.sql) -- self-inflicted only (no
-- cross-user fund exposure; the ownership half of the check already
-- prevents that), but a real silent-failure bug for the colliding user.
--
-- Fix: add `and t.type = 'p2p_transfer'` to both places the ownership
-- check queries ledger_entries/transactions -- the initial fast-path
-- check and the unique_violation recovery re-check inside the EXCEPTION
-- block. Nothing else in the function changes: the MFA/AAL2 check, the
-- account-ordering deadlock-avoidance locking, and the balance checks are
-- byte-for-byte identical to the version reviewed and signed off in
-- Task 5's own Fix Round 1.
create or replace function public.transfer_funds(
  p_recipient_account_id uuid,
  p_amount_cents bigint,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_account_id uuid;
  v_sender_balance bigint;
  v_recipient_balance bigint;
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

  select id into v_sender_account_id from public.accounts where user_id = auth.uid();

  if v_sender_account_id is null then
    raise exception 'sender account not found' using errcode = 'P0002';
  end if;

  -- Idempotency check #1 (pre-lock fast path): idempotency_key is
  -- globally unique across all of transactions (deposits/withdrawals key
  -- their own dedup off it too, with no user session to scope it to), so
  -- a bare key match is not by itself proof the caller owns that
  -- transaction — it could belong to a different user entirely (e.g. an
  -- attacker who predicted/registered a victim's future key first), or
  -- to this same user's own record_withdrawal call that happened to
  -- reuse the key (Fix Round 1 addition: the `and t.type = 'p2p_transfer'`
  -- clause below). Only treat it as "already processed" if the caller's
  -- own account has a debit ledger entry for it AND the transaction is
  -- genuinely a transfer; otherwise this is a key collision with
  -- someone else's or a differently-typed transaction, which must fail
  -- loudly rather than silently reporting fake success.
  select id into v_existing_transaction_id
  from public.transactions
  where idempotency_key = p_idempotency_key;

  if v_existing_transaction_id is not null then
    if exists (
      select 1 from public.ledger_entries le
      join public.transactions t on t.id = le.transaction_id
      where le.transaction_id = v_existing_transaction_id
        and le.account_id = v_sender_account_id
        and le.direction = 'debit'
        and t.type = 'p2p_transfer'
    ) then
      return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
    else
      raise exception 'idempotency key already used for a different transaction' using errcode = '23505';
    end if;
  end if;

  if v_sender_account_id = p_recipient_account_id then
    raise exception 'cannot transfer to your own account' using errcode = '22023';
  end if;

  if not exists (select 1 from public.accounts where id = p_recipient_account_id) then
    raise exception 'recipient account not found' using errcode = 'P0002';
  end if;

  -- Lock both accounts in a stable order (by id) so two concurrent
  -- transfers touching the same pair of accounts can never deadlock.
  perform 1 from public.accounts
  where id in (v_sender_account_id, p_recipient_account_id)
  order by id
  for update;

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_sender_balance
  from public.ledger_entries where account_id = v_sender_account_id;

  if v_sender_balance < p_amount_cents then
    raise exception 'insufficient balance' using errcode = '23514';
  end if;

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_recipient_balance
  from public.ledger_entries where account_id = p_recipient_account_id;

  -- Idempotency check #2 (race recovery): check #1 above ran before the
  -- row lock, so two truly concurrent calls with the identical key can
  -- both pass it and race to insert. The loser hits the unique
  -- constraint on transactions.idempotency_key. plpgsql's
  -- EXCEPTION clause implicitly opens a subtransaction (savepoint), so
  -- catching unique_violation here rolls back only this insert attempt,
  -- not the whole function call — letting us recover by re-running the
  -- same ownership-and-type-checked lookup as check #1 and returning the
  -- correct outcome instead of surfacing a raw 23505 to a legitimate
  -- retry.
  begin
    insert into public.transactions (type, status, initiated_by, idempotency_key)
    values ('p2p_transfer', 'completed', auth.uid(), p_idempotency_key)
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
          and le.account_id = v_sender_account_id
          and le.direction = 'debit'
          and t.type = 'p2p_transfer'
      ) then
        return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
      else
        raise exception 'idempotency key already used for a different transaction' using errcode = '23505';
      end if;
  end;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (v_sender_account_id, v_transaction_id, p_amount_cents, 'debit', v_sender_balance - p_amount_cents);

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (p_recipient_account_id, v_transaction_id, p_amount_cents, 'credit', v_recipient_balance + p_amount_cents);

  return jsonb_build_object('transaction_id', v_transaction_id, 'status', 'completed');
end;
$$;
