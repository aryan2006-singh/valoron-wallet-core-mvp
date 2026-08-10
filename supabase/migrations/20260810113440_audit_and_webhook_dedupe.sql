create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  target_table text not null,
  target_id text not null,
  ip_address inet,
  user_agent text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from authenticated, anon;

-- Explicit service_role grant: as established in Task 3 (see
-- 20260810104903_core_ledger_schema.sql), nothing is auto-granted to any
-- Data API role on a new table, so without this the admin client's own
-- read of its own audit trail (this task's test, and any future
-- admin/support tooling) would fail with "permission denied" rather than
-- being row-filtered. audit_log is written exclusively by the SECURITY
-- DEFINER trigger functions below (which run as the function owner, not
-- service_role, so they need no grant of their own) — service_role only
-- ever needs to *read* it, never insert/update/delete directly, so this
-- stays SELECT-only to keep the append-only audit trail tamper-resistant
-- even from the trusted service role.
grant select on public.audit_log to service_role;

create table public.webhook_events (
  id text primary key,
  type text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

alter table public.webhook_events enable row level security;
revoke all on public.webhook_events from authenticated, anon;

-- Explicit service_role grant: webhook_events has no SECURITY DEFINER
-- function of its own — Task 10's Stripe webhook handler will read/write
-- this table directly via the admin (service_role) client to dedupe
-- incoming events by id (select-then-insert), so service_role needs base
-- SELECT + INSERT here. No UPDATE/DELETE: per the design spec, a
-- processed event is represented by the row's mere existence
-- (processed_at defaults at insert time) — rows are never mutated or
-- removed after the fact, keeping the dedupe log itself append-only too.
-- Nothing in Task 4 exercises this yet (no writes to webhook_events
-- happen until Task 10), so it is not covered by this task's own tests;
-- it is added now, verified against the design spec's documented dedupe
-- flow, so Task 10 doesn't hit a silent "permission denied" later.
grant select, insert on public.webhook_events to service_role;

create function public.log_financial_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (actor_id, action, target_table, target_id, metadata)
  values (
    coalesce(new.initiated_by, auth.uid()),
    tg_op,
    tg_table_name,
    new.id::text,
    to_jsonb(new)
  );
  return new;
end;
$$;

create trigger audit_transactions_change
  after insert or update on public.transactions
  for each row execute function public.log_financial_mutation();

create trigger audit_ledger_entries_insert
  after insert on public.ledger_entries
  for each row execute function public.log_financial_mutation();

create function public.log_kyc_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kyc_status is distinct from old.kyc_status then
    insert into public.audit_log (actor_id, action, target_table, target_id, metadata)
    values (
      new.id,
      'kyc_status_change',
      'profiles',
      new.id::text,
      jsonb_build_object('from', old.kyc_status, 'to', new.kyc_status)
    );
  end if;
  return new;
end;
$$;

create trigger audit_kyc_status_change
  after update on public.profiles
  for each row execute function public.log_kyc_status_change();

-- Fix for a Task 3 gap, discovered by this task's own TDD RED step:
-- Task 3's migration granted service_role only SELECT on
-- public.transactions (see the "Explicit base grants" comment there),
-- reasoning at the time that neither the handle_new_user trigger nor
-- Task 5/6's future RPC functions would need more, since SECURITY
-- DEFINER functions run as their owner rather than as the calling role
-- — and explicitly left the door open for "a future task [to] add it
-- explicitly if a concrete need shows up."
--
-- That concrete need is this task's own audit-log test: it inserts a
-- transactions row directly via the admin (service_role) client to
-- exercise the audit_transactions_change trigger end-to-end, before
-- Task 5/6's record_deposit/record_withdrawal/transfer_funds RPCs exist
-- to be the sole write path. Without this grant the insert itself fails
-- with 42501 "permission denied for table transactions" — confirmed via
-- this task's RED run — independent of whether audit_log exists.
--
-- Scoped to INSERT only (no UPDATE/DELETE), preserving the design spec's
-- "the three RPC functions are the only write path for money" intent as
-- closely as possible while still letting this task's direct-insert test
-- work. Once Task 5/6 land the SECURITY DEFINER RPC functions, that task
-- should revisit whether this grant is still needed for test convenience
-- or should be revoked in favor of routing all writes exclusively through
-- the RPCs (flagged in this task's report for that follow-up decision).
grant insert on public.transactions to service_role;
