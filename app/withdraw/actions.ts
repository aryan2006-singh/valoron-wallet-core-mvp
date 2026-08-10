'use server'

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { withdrawalSchema } from '@/lib/validation/wallet'
import { withdrawalRateLimit, enforceRateLimit } from '@/lib/rate-limit'
import { requireVerifiedMfa } from '@/lib/auth/mfa'

// record_withdrawal's SQL return type is `jsonb`, which the generated
// Supabase types surface as the generic `Json` union — cast to the known
// shape (mirrors the `as RpcResult` convention used in this project's RPC
// integration tests) rather than widening the RPC's actual contract.
type RpcResult = { transaction_id: string; status: string }

export async function requestWithdrawal(
  amountCents: number
): Promise<{ status: 'pending' } | { error: string }> {
  const parsed = withdrawalSchema.safeParse({ amountCents })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const mfa = await requireVerifiedMfa()
  if (!mfa.ok) return { error: mfa.error }

  const allowed = await enforceRateLimit(withdrawalRateLimit, mfa.userId)
  if (!allowed) return { error: 'Too many withdrawal attempts. Try again later.' }

  const supabase = await createClient()
  const idempotencyKey = `withdrawal-${mfa.userId}-${Date.now()}`

  const { data: rpcResult, error } = await supabase.rpc('record_withdrawal', {
    p_amount_cents: parsed.data.amountCents,
    p_idempotency_key: idempotencyKey,
  })
  if (error) return { error: error.message }
  const result = rpcResult as RpcResult

  try {
    await stripe.payouts.create(
      { amount: parsed.data.amountCents, currency: 'usd', metadata: { transaction_id: result.transaction_id } },
      { idempotencyKey }
    )
  } catch (payoutError) {
    // The ledger was already debited by record_withdrawal above; the RPC
    // grants authenticated users permission to reverse their own
    // still-pending withdrawal (see Task 6), so this runs in the user's
    // own session — no admin client involved.
    await supabase.rpc('reverse_withdrawal', {
      p_transaction_id: result.transaction_id,
      p_reason: payoutError instanceof Error ? payoutError.message : 'payout_creation_failed',
    })
    return { error: 'Withdrawal could not be initiated. Your balance has been restored.' }
  }

  return { status: 'pending' }
}
