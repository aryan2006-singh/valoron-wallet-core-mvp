'use server'

import { createClient } from '@/lib/supabase/server'
import { reverseFailedWithdrawal } from '@/lib/supabase/withdrawal-reversal'
import { stripe } from '@/lib/stripe/client'
import { withdrawalSchema } from '@/lib/validation/wallet'
import { withdrawalRateLimit, enforceRateLimit } from '@/lib/rate-limit'
import { requireVerifiedMfa } from '@/lib/auth/mfa'
import { logger } from '@/lib/logger'

// record_withdrawal's SQL return type is `jsonb`, which the generated
// Supabase types surface as the generic `Json` union — cast to the known
// shape (mirrors the `as RpcResult` convention used in this project's RPC
// integration tests) rather than widening the RPC's actual contract.
type RpcResult = { transaction_id: string; status: string }

// The compensating-reversal path below is the single most important thing
// in this file to have logged: it is the only place where the ledger is
// debited and then un-debited, and without a log an operator has no way
// to tell a reversed withdrawal from one that never happened.
const withdrawLog = logger.child({ area: 'withdrawal' })

export async function requestWithdrawal(
  amountCents: number
): Promise<{ status: 'pending' } | { error: string }> {
  const parsed = withdrawalSchema.safeParse({ amountCents })
  if (!parsed.success) {
    withdrawLog.info({ amountCents, reason: parsed.error.issues[0].message }, 'withdrawal rejected: validation failed')
    return { error: parsed.error.issues[0].message }
  }

  const mfa = await requireVerifiedMfa()
  if (!mfa.ok) {
    withdrawLog.warn({ amountCents, reason: mfa.error }, 'withdrawal denied: MFA not satisfied')
    return { error: mfa.error }
  }

  const allowed = await enforceRateLimit(withdrawalRateLimit, mfa.userId)
  if (!allowed) {
    withdrawLog.warn({ userId: mfa.userId, amountCents }, 'withdrawal blocked: rate limit exceeded')
    return { error: 'Too many withdrawal attempts. Try again later.' }
  }

  const supabase = await createClient()
  const idempotencyKey = `withdrawal-${crypto.randomUUID()}`

  withdrawLog.info(
    { userId: mfa.userId, amountCents: parsed.data.amountCents, idempotencyKey },
    'withdrawal initiated'
  )

  const { data: rpcResult, error } = await supabase.rpc('record_withdrawal', {
    p_amount_cents: parsed.data.amountCents,
    p_idempotency_key: idempotencyKey,
  })
  if (error) {
    withdrawLog.warn(
      { userId: mfa.userId, amountCents: parsed.data.amountCents, idempotencyKey, err: error.message },
      'withdrawal failed: ledger debit refused'
    )
    return { error: error.message }
  }
  const result = rpcResult as RpcResult

  withdrawLog.info(
    { userId: mfa.userId, amountCents: parsed.data.amountCents, transactionId: result.transaction_id },
    'withdrawal debited, requesting payout'
  )

  try {
    const payout = await stripe.payouts.create(
      { amount: parsed.data.amountCents, currency: 'usd', metadata: { transaction_id: result.transaction_id } },
      { idempotencyKey }
    )
    withdrawLog.info(
      {
        userId: mfa.userId,
        amountCents: parsed.data.amountCents,
        transactionId: result.transaction_id,
        payoutId: payout.id,
      },
      'withdrawal payout created'
    )
  } catch (payoutError) {
    // The ledger was already debited by record_withdrawal above. The
    // reversal runs as service_role through a single-purpose helper:
    // reverse_withdrawal is deliberately NOT callable from the user's own
    // session, or a user could reverse a withdrawal whose payout had
    // already been sent (see lib/supabase/withdrawal-reversal.ts).
    const reason = payoutError instanceof Error ? payoutError.message : 'payout_creation_failed'
    withdrawLog.error(
      { userId: mfa.userId, amountCents: parsed.data.amountCents, transactionId: result.transaction_id, reason },
      'withdrawal payout failed, reversing ledger debit'
    )

    const { error: reverseError } = await reverseFailedWithdrawal(result.transaction_id, reason)
    if (reverseError) {
      // A failed reversal means money is debited with no payout behind
      // it. That needs a human, so it is logged at fatal.
      withdrawLog.fatal(
        {
          userId: mfa.userId,
          amountCents: parsed.data.amountCents,
          transactionId: result.transaction_id,
          err: reverseError.message,
        },
        'withdrawal reversal FAILED — balance not restored, manual intervention required'
      )
    } else {
      withdrawLog.info(
        { userId: mfa.userId, amountCents: parsed.data.amountCents, transactionId: result.transaction_id },
        'withdrawal reversed, balance restored'
      )
    }
    return { error: 'Withdrawal could not be initiated. Your balance has been restored.' }
  }

  return { status: 'pending' }
}
