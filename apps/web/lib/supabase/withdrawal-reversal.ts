import { createAdminClient } from '@/lib/supabase/admin'

/**
 * SECURITY: undoes the ledger debit of a withdrawal whose Stripe payout
 * could not be created. This is the only non-webhook code allowed to use
 * the service-role client, and it exposes exactly one operation.
 *
 * Why it can't run in the user's own session: a withdrawal stays
 * 'pending' until payout.paid arrives, so if users could call
 * reverse_withdrawal themselves they could reverse a withdrawal whose
 * payout had already been sent and keep both. reverse_withdrawal is
 * therefore granted to service_role only (see
 * apps/api/supabase/migrations/20261112190000_backend_hardening.sql).
 *
 * Only import this from app/(app)/withdraw/actions.ts, and only pass it a
 * transaction id that the same request just created via record_withdrawal.
 * tests/unit/supabase-admin-import.test.ts enforces the import rule.
 */
export async function reverseFailedWithdrawal(transactionId: string, reason: string) {
  const admin = createAdminClient()
  return admin.rpc('reverse_withdrawal', { p_transaction_id: transactionId, p_reason: reason })
}
