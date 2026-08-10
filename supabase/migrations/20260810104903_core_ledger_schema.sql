-- profiles: one row per authenticated user
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  kyc_status text not null default 'unverified'
    check (kyc_status in ('unverified','pending','verified','rejected')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- Column-level grant: RLS above only filters *rows*, so without this a
-- user could still update their own kyc_status column directly. Only
-- full_name is client-writable; kyc_status changes only via the
-- request_kyc_verification RPC (Task 11) or the service role (webhook).
revoke update on public.profiles from authenticated, anon;
grant update (full_name) on public.profiles to authenticated;

-- accounts: exactly one wallet per user for this MVP
create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  currency text not null default 'USD',
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

create policy "accounts_select_own" on public.accounts
  for select using (auth.uid() = user_id);

-- transactions: one row per logical money movement
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('p2p_transfer','deposit','withdrawal')),
  status text not null default 'pending'
    check (status in ('pending','completed','failed','reversed')),
  initiated_by uuid references public.profiles(id),
  stripe_reference text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.transactions enable row level security;

-- ledger_entries: append-only double-entry rows
create table public.ledger_entries (
  id bigint generated always as identity primary key,
  account_id uuid not null references public.accounts(id),
  transaction_id uuid not null references public.transactions(id),
  amount_cents bigint not null check (amount_cents > 0),
  direction text not null check (direction in ('credit','debit')),
  balance_after_cents bigint not null check (balance_after_cents >= 0),
  created_at timestamptz not null default now()
);

alter table public.ledger_entries enable row level security;

create policy "ledger_entries_select_own" on public.ledger_entries
  for select using (
    exists (
      select 1 from public.accounts a
      where a.id = ledger_entries.account_id and a.user_id = auth.uid()
    )
  );

create policy "transactions_select_own" on public.transactions
  for select using (
    exists (
      select 1 from public.ledger_entries le
      join public.accounts a on a.id = le.account_id
      where le.transaction_id = transactions.id and a.user_id = auth.uid()
    )
  );

-- Defense in depth: no INSERT/UPDATE/DELETE policies exist above for
-- ledger_entries/transactions/accounts, but explicitly revoke the grants
-- too, so a future accidental permissive policy still can't be exploited
-- by the client roles.
revoke insert, update, delete on public.transactions from authenticated, anon;
revoke insert, update, delete on public.ledger_entries from authenticated, anon;
revoke insert, update, delete on public.accounts from authenticated, anon;
revoke insert, delete on public.profiles from authenticated, anon;

-- Auto-create a profile + account when a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');

  insert into public.accounts (user_id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
