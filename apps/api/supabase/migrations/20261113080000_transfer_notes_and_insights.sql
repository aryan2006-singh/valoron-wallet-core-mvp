-- Transfer notes + categories, and a per-user cache for AI weekly insights.
--
-- 1. transactions gets two optional, user-visible columns:
--    * note      - free text the sender types on the Send form (<= 140 chars)
--    * category  - one of a fixed set, picked by the app from the note
--    Both parties to a transfer can already read the transaction row via
--    transactions_select_own, so the recipient sees the note too, like a
--    memo line on a cheque.
--
-- 2. transfer_funds gains p_note / p_category (both default null, so every
--    existing 3-argument caller and test keeps working). The old 3-arg
--    signature is dropped first: keeping it alongside a 5-arg version with
--    defaults would make 3-arg calls ambiguous. The body below is the
--    20260810160335 version byte-for-byte except for the two new inputs,
--    their validation, and the transactions insert that stores them.
--
-- 3. weekly_insights caches one generated summary per user per week so the
--    dashboard doesn't call the model on every page load.

alter table public.transactions
  add column note text check (note is null or char_length(note) between 1 and 140),
  add column category text check (
    category is null or category in (
      'food','groceries','rent','bills','transport','shopping',
      'entertainment','travel','health','gifts','friends','other'
    )
  );

drop function public.transfer_funds(uuid, bigint, text);

create or replace function public.transfer_funds(
  p_recipient_account_id uuid,
  p_amount_cents bigint,
  p_idempotency_key text,
  p_note text default null,
  p_category text default null
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

  if p_note is not null and char_length(p_note) > 140 then
    raise exception 'note must be 140 characters or fewer' using errcode = '22023';
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
    insert into public.transactions (type, status, initiated_by, idempotency_key, note, category)
    values ('p2p_transfer', 'completed', auth.uid(), p_idempotency_key, nullif(btrim(p_note), ''), p_category)
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

revoke execute on function public.transfer_funds(uuid, bigint, text, text, text) from public;
grant execute on function public.transfer_funds(uuid, bigint, text, text, text) to authenticated;

create table public.weekly_insights (
  user_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  summary text not null check (char_length(summary) <= 1000),
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);

alter table public.weekly_insights enable row level security;

-- The summary is derived only from the user's own transactions and only
-- ever shown back to that same user, so letting them write their own row
-- (rather than routing through a security-definer RPC) exposes nothing.
create policy "weekly_insights_select_own" on public.weekly_insights
  for select using (auth.uid() = user_id);
create policy "weekly_insights_insert_own" on public.weekly_insights
  for insert with check (auth.uid() = user_id);
create policy "weekly_insights_update_own" on public.weekly_insights
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update on public.weekly_insights to authenticated;
grant select on public.weekly_insights to service_role;
revoke all on public.weekly_insights from anon;
