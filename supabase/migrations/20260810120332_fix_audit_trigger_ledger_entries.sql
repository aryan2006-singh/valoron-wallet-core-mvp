-- Bug fix, discovered by this task's (Task 5) own TDD RED step: Task 4's
-- log_financial_mutation() trigger function unconditionally read
-- `new.initiated_by`, but that column only exists on public.transactions.
-- The same function is also wired up as the `audit_ledger_entries_insert`
-- trigger on public.ledger_entries, which has no `initiated_by` column at
-- all — so any insert into ledger_entries raised
-- "record \"new\" has no field \"initiated_by\"" (42703) before ever
-- reaching the audit_log insert.
--
-- This went undetected in Task 4 because its own audit-log test only
-- inserted into transactions directly, and no ledger_entries insert had
-- ever successfully run up to that point: no RPC wrote to ledger_entries
-- yet, and service_role had no INSERT grant on it either (see this same
-- migration set's grant fix, alongside this file). This task's fundAccount
-- test helper is the first code path to actually insert into
-- ledger_entries, which is what surfaced the bug.
--
-- Fix: pull `initiated_by` out via to_jsonb(new)->>'initiated_by' instead
-- of a direct column reference. The ->> operator on jsonb returns SQL
-- NULL for a key that doesn't exist in the JSON object (never an error),
-- so this now works uniformly for both transactions (falls back to
-- auth.uid() only when initiated_by is unset) and ledger_entries (always
-- falls back to auth.uid(), since the column is absent).
create or replace function public.log_financial_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (actor_id, action, target_table, target_id, metadata)
  values (
    coalesce((to_jsonb(new) ->> 'initiated_by')::uuid, auth.uid()),
    tg_op,
    tg_table_name,
    new.id::text,
    to_jsonb(new)
  );
  return new;
end;
$$;
