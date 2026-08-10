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

  select id into v_existing_transaction_id
  from public.transactions
  where idempotency_key = p_idempotency_key;

  if v_existing_transaction_id is not null then
    return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
  end if;

  select id into v_sender_account_id from public.accounts where user_id = auth.uid();

  if v_sender_account_id is null then
    raise exception 'sender account not found' using errcode = 'P0002';
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

  insert into public.transactions (type, status, initiated_by, idempotency_key)
  values ('p2p_transfer', 'completed', auth.uid(), p_idempotency_key)
  returning id into v_transaction_id;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (v_sender_account_id, v_transaction_id, p_amount_cents, 'debit', v_sender_balance - p_amount_cents);

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (p_recipient_account_id, v_transaction_id, p_amount_cents, 'credit', v_recipient_balance + p_amount_cents);

  return jsonb_build_object('transaction_id', v_transaction_id, 'status', 'completed');
end;
$$;

revoke execute on function public.transfer_funds(uuid, bigint, text) from public;
grant execute on function public.transfer_funds(uuid, bigint, text) to authenticated;

-- Test-fixture grant, discovered via this task's own TDD RED step (same
-- pattern as the service_role/transactions gap Task 4 found and fixed):
-- fundAccount() in tests/integration/helpers/create-verified-user.ts
-- bootstraps a starting balance directly via the admin (service_role)
-- client, bypassing RLS, standing in for Task 6's record_deposit RPC
-- before it exists. Without this grant, that insert fails with 42501
-- "permission denied for table ledger_entries" — confirmed directly
-- against the local instance — and every transfer_funds test that relies
-- on fundAccount silently starts from a zero balance instead of failing
-- loudly, which is worse. transfer_funds itself never needs this grant:
-- it is SECURITY DEFINER and writes to ledger_entries as its own function
-- owner (postgres), not as service_role.
grant insert on public.ledger_entries to service_role;
