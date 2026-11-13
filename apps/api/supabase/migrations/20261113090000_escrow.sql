-- Escrow: one user locks funds for another; the funder releases them to the
-- recipient when satisfied. Money never leaves the ledger: funding debits the
-- funder's account (so the funds are no longer spendable), and the hold row is
-- the claim on them until release (credit recipient) or refund (credit funder).

alter table public.transactions drop constraint transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('p2p_transfer','deposit','withdrawal','escrow_fund','escrow_release','escrow_refund'));

create table public.escrows (
  id uuid primary key default gen_random_uuid(),
  funder_account_id uuid not null references public.accounts(id),
  recipient_account_id uuid not null references public.accounts(id),
  amount_cents bigint not null check (amount_cents > 0),
  description text check (description is null or char_length(description) <= 140),
  status text not null default 'held' check (status in ('held','released','refunded')),
  fund_transaction_id uuid not null references public.transactions(id),
  resolve_transaction_id uuid references public.transactions(id),
  expires_at timestamptz not null default (now() + interval '14 days'),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (funder_account_id <> recipient_account_id)
);

alter table public.escrows enable row level security;

create policy "escrows_select_party" on public.escrows
  for select using (
    exists (
      select 1 from public.accounts a
      where a.user_id = auth.uid()
        and a.id in (escrows.funder_account_id, escrows.recipient_account_id)
    )
  );

grant select on public.escrows to authenticated, service_role;
revoke insert, update, delete, truncate, trigger, references on public.escrows from authenticated, anon;

-- Same audit trail as transactions/ledger_entries: log_financial_mutation()
-- reads initiated_by via to_jsonb(new), so it works on any table with an id.
create trigger audit_escrows_change
  after insert or update on public.escrows
  for each row execute function public.log_financial_mutation();

-- ---------------------------------------------------------------------------
-- Shared helper: balance of an account from the ledger.
-- ---------------------------------------------------------------------------
create function public.escrow_account_balance(p_account_id uuid)
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce(sum(case when direction = 'credit' then amount_cents else -amount_cents end), 0)
  from public.ledger_entries where account_id = p_account_id;
$$;
revoke all on function public.escrow_account_balance(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- fund_escrow: funder's balance -> held. Requires MFA like any money movement.
-- ---------------------------------------------------------------------------
create function public.fund_escrow(
  p_recipient_account_id uuid,
  p_amount_cents bigint,
  p_description text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_funder_account_id uuid;
  v_balance bigint;
  v_transaction_id uuid;
  v_escrow_id uuid;
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

  select id into v_funder_account_id from public.accounts where user_id = auth.uid();
  if v_funder_account_id is null then
    raise exception 'funder account not found' using errcode = 'P0002';
  end if;

  select id into v_existing_transaction_id from public.transactions where idempotency_key = p_idempotency_key;
  if v_existing_transaction_id is not null then
    if exists (
      select 1 from public.escrows e
      where e.fund_transaction_id = v_existing_transaction_id and e.funder_account_id = v_funder_account_id
    ) then
      return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
    end if;
    raise exception 'idempotency key already used for a different transaction' using errcode = '23505';
  end if;

  if v_funder_account_id = p_recipient_account_id then
    raise exception 'cannot escrow to your own account' using errcode = '22023';
  end if;

  if not exists (select 1 from public.accounts where id = p_recipient_account_id) then
    raise exception 'recipient account not found' using errcode = 'P0002';
  end if;

  perform 1 from public.accounts where id = v_funder_account_id for update;

  v_balance := public.escrow_account_balance(v_funder_account_id);
  if v_balance < p_amount_cents then
    raise exception 'insufficient balance' using errcode = '23514';
  end if;

  begin
    insert into public.transactions (type, status, initiated_by, idempotency_key)
    values ('escrow_fund', 'completed', auth.uid(), p_idempotency_key)
    returning id into v_transaction_id;
  exception
    when unique_violation then
      select id into v_existing_transaction_id from public.transactions where idempotency_key = p_idempotency_key;
      if exists (
        select 1 from public.escrows e
        where e.fund_transaction_id = v_existing_transaction_id and e.funder_account_id = v_funder_account_id
      ) then
        return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
      end if;
      raise exception 'idempotency key already used for a different transaction' using errcode = '23505';
  end;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (v_funder_account_id, v_transaction_id, p_amount_cents, 'debit', v_balance - p_amount_cents);

  insert into public.escrows (funder_account_id, recipient_account_id, amount_cents, description, fund_transaction_id)
  values (v_funder_account_id, p_recipient_account_id, p_amount_cents, nullif(btrim(p_description), ''), v_transaction_id)
  returning id into v_escrow_id;

  return jsonb_build_object('transaction_id', v_transaction_id, 'escrow_id', v_escrow_id, 'status', 'completed');
end;
$$;

-- ---------------------------------------------------------------------------
-- resolve_escrow (internal): shared body of release and refund. Locks the hold
-- row first so two concurrent resolutions can never both succeed, then credits
-- the chosen account.
-- ---------------------------------------------------------------------------
create function public.resolve_escrow(
  p_escrow_id uuid,
  p_release boolean,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_escrow public.escrows%rowtype;
  v_caller_account_id uuid;
  v_target_account_id uuid;
  v_balance bigint;
  v_transaction_id uuid;
  v_existing_transaction_id uuid;
  v_tx_type text := case when p_release then 'escrow_release' else 'escrow_refund' end;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  if coalesce((auth.jwt() ->> 'aal'), '') <> 'aal2' then
    raise exception 'mfa verification required' using errcode = '28000';
  end if;

  select id into v_caller_account_id from public.accounts where user_id = auth.uid();

  select id into v_existing_transaction_id from public.transactions where idempotency_key = p_idempotency_key;
  if v_existing_transaction_id is not null then
    if exists (
      select 1 from public.escrows e
      where e.resolve_transaction_id = v_existing_transaction_id
        and auth.uid() in (
          select user_id from public.accounts where id in (e.funder_account_id, e.recipient_account_id)
        )
    ) then
      return jsonb_build_object('transaction_id', v_existing_transaction_id, 'status', 'already_processed');
    end if;
    raise exception 'idempotency key already used for a different transaction' using errcode = '23505';
  end if;

  select * into v_escrow from public.escrows where id = p_escrow_id for update;
  if not found then
    raise exception 'escrow not found' using errcode = 'P0002';
  end if;

  -- Who may do what: only the funder releases; the recipient may decline
  -- (refund) at any time; the funder may take the money back only once the
  -- hold has expired, so a release promise cannot be yanked back instantly.
  if p_release then
    if v_caller_account_id is distinct from v_escrow.funder_account_id then
      raise exception 'only the funder can release this escrow' using errcode = '42501';
    end if;
  else
    if v_caller_account_id = v_escrow.recipient_account_id then
      null;
    elsif v_caller_account_id = v_escrow.funder_account_id then
      if now() < v_escrow.expires_at then
        raise exception 'funder can refund only after the escrow expires' using errcode = '42501';
      end if;
    else
      raise exception 'not a party to this escrow' using errcode = '42501';
    end if;
  end if;

  if v_escrow.status <> 'held' then
    raise exception 'escrow is already %', v_escrow.status using errcode = '22023';
  end if;

  v_target_account_id := case when p_release then v_escrow.recipient_account_id else v_escrow.funder_account_id end;

  perform 1 from public.accounts where id = v_target_account_id for update;
  v_balance := public.escrow_account_balance(v_target_account_id);

  insert into public.transactions (type, status, initiated_by, idempotency_key)
  values (v_tx_type, 'completed', auth.uid(), p_idempotency_key)
  returning id into v_transaction_id;

  insert into public.ledger_entries (account_id, transaction_id, amount_cents, direction, balance_after_cents)
  values (v_target_account_id, v_transaction_id, v_escrow.amount_cents, 'credit', v_balance + v_escrow.amount_cents);

  update public.escrows
  set status = case when p_release then 'released' else 'refunded' end,
      resolve_transaction_id = v_transaction_id,
      resolved_at = now()
  where id = p_escrow_id;

  return jsonb_build_object('transaction_id', v_transaction_id, 'status', 'completed');
end;
$$;
revoke all on function public.resolve_escrow(uuid, boolean, text) from public, anon, authenticated;

create function public.release_escrow(p_escrow_id uuid, p_idempotency_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.resolve_escrow(p_escrow_id, true, p_idempotency_key);
$$;

create function public.refund_escrow(p_escrow_id uuid, p_idempotency_key text)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.resolve_escrow(p_escrow_id, false, p_idempotency_key);
$$;

-- ---------------------------------------------------------------------------
-- my_escrows: the caller's holds with the other party's display name (profiles
-- are RLS-private, so the name is read here instead of by the client).
-- ---------------------------------------------------------------------------
create function public.my_escrows()
returns table (
  id uuid,
  role text,
  counterparty_name text,
  amount_cents bigint,
  description text,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  can_refund boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.id,
    case when fa.user_id = auth.uid() then 'funder' else 'recipient' end,
    coalesce(nullif(p.full_name, ''), 'Valoron user'),
    e.amount_cents,
    e.description,
    e.status,
    e.created_at,
    e.expires_at,
    (e.status = 'held' and (ra.user_id = auth.uid() or e.expires_at <= now()))
  from public.escrows e
  join public.accounts fa on fa.id = e.funder_account_id
  join public.accounts ra on ra.id = e.recipient_account_id
  join public.profiles p on p.id = case when fa.user_id = auth.uid() then ra.user_id else fa.user_id end
  where auth.uid() in (fa.user_id, ra.user_id)
  order by e.created_at desc;
$$;

-- Only signed-in users may call the escrow RPCs. (CREATE FUNCTION grants
-- EXECUTE to PUBLIC by default, hence the explicit revokes.)
revoke all on function public.fund_escrow(uuid, bigint, text, text) from public, anon;
revoke all on function public.release_escrow(uuid, text) from public, anon;
revoke all on function public.refund_escrow(uuid, text) from public, anon;
revoke all on function public.my_escrows() from public, anon;
grant execute on function public.fund_escrow(uuid, bigint, text, text) to authenticated;
grant execute on function public.release_escrow(uuid, text) to authenticated;
grant execute on function public.refund_escrow(uuid, text) to authenticated;
grant execute on function public.my_escrows() to authenticated;
