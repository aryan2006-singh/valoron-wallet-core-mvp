-- Backend hardening pass.
--
-- 1. reverse_withdrawal is no longer callable by `authenticated` users.
--
--    It was granted to end users so the withdraw server action could undo
--    its own ledger debit, in the user's session, when stripe.payouts.create
--    failed synchronously. But the function cannot tell that call apart
--    from the same user calling it straight from the browser (the anon key
--    plus their session is all it takes), and a withdrawal stays 'pending'
--    from the moment record_withdrawal debits it until payout.paid arrives,
--    which for real payouts is days later. So a user could:
--
--      withdraw -> server action creates the Stripe payout (money leaves)
--      -> user calls reverse_withdrawal on their still-pending withdrawal
--      -> balance is credited back
--      -> payout.paid arrives, confirm_withdrawal finds nothing pending
--
--    and end up with both the payout and the balance. The reversal now
--    runs only as service_role: from the payout.failed webhook, and from
--    the withdraw server action through a dedicated server-only helper
--    (apps/web/lib/supabase/withdrawal-reversal.ts) that can call nothing
--    but this one RPC.
--
-- 2. record_deposit locks the account row BEFORE its idempotency check.
--    The webhook route now records an event as processed only after its
--    handler succeeds (so a failed handler is retried instead of being
--    deduped forever), which means two concurrent deliveries of the same
--    event can both reach this function. Taking the lock first serializes
--    them, so the second always sees the first's transaction and returns
--    'already_processed' rather than racing it to the unique constraint.
--    The unique_violation fallback below covers the remaining case (the
--    same key used concurrently against a different account).

revoke execute on function public.reverse_withdrawal(uuid, text) from authenticated;

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

  perform 1 from public.accounts where id = p_account_id for update;
  if not found then
    raise exception 'account not found' using errcode = 'P0002';
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

  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  into v_balance
  from public.ledger_entries where account_id = p_account_id;

  begin
    insert into public.transactions (type, status, stripe_reference, idempotency_key)
    values ('deposit', 'completed', p_stripe_reference, p_idempotency_key)
    returning id into v_transaction_id;
  exception
    when unique_violation then
      raise exception 'idempotency key already used for a different transaction' using errcode = '23505';
  end;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (p_account_id, v_transaction_id, p_amount_cents, 'credit', v_balance + p_amount_cents);

  return jsonb_build_object('transaction_id', v_transaction_id, 'status', 'completed');
end;
$$;

revoke execute on function public.record_deposit(uuid, bigint, text, text) from public, authenticated, anon;
grant execute on function public.record_deposit(uuid, bigint, text, text) to service_role;
