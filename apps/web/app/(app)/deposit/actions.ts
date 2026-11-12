'use server'

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { depositSchema } from '@/lib/validation/wallet'
import { depositRateLimit, enforceRateLimit } from '@/lib/rate-limit'
import { logger } from '@/lib/logger'

// Note what is absent here: the PaymentIntent's client_secret. It is a
// bearer credential for confirming the payment, so it is returned to the
// caller but never logged. Only the intent id is recorded, which is what
// you actually need to reconcile against Stripe.
const depositLog = logger.child({ area: 'deposit' })

export async function createDepositIntent(
  amountCents: number
): Promise<{ clientSecret: string } | { error: string }> {
  const parsed = depositSchema.safeParse({ amountCents })
  if (!parsed.success) {
    depositLog.info({ amountCents, reason: parsed.error.issues[0].message }, 'deposit rejected: validation failed')
    return { error: parsed.error.issues[0].message }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    depositLog.warn({ amountCents }, 'deposit denied: not authenticated')
    return { error: 'Not authenticated' }
  }

  const { data: account } = await supabase.from('accounts').select('id').eq('user_id', user.id).single()
  if (!account) {
    depositLog.error({ userId: user.id, amountCents }, 'deposit failed: account not found')
    return { error: 'Account not found' }
  }

  const allowed = await enforceRateLimit(depositRateLimit, user.id)
  if (!allowed) {
    // Card-testing fraud shows up here first, so this is a warn.
    depositLog.warn({ userId: user.id, accountId: account.id, amountCents }, 'deposit blocked: rate limit exceeded')
    return { error: 'Too many deposit attempts. Try again later.' }
  }

  const idempotencyKey = `deposit-${crypto.randomUUID()}`
  try {
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: parsed.data.amountCents,
        currency: 'usd',
        metadata: { account_id: account.id, idempotency_key: idempotencyKey },
      },
      { idempotencyKey }
    )

    depositLog.info(
      {
        userId: user.id,
        accountId: account.id,
        amountCents: parsed.data.amountCents,
        idempotencyKey,
        paymentIntentId: paymentIntent.id,
      },
      'deposit intent created'
    )
    return { clientSecret: paymentIntent.client_secret! }
  } catch (err) {
    depositLog.error(
      { userId: user.id, accountId: account.id, amountCents: parsed.data.amountCents, idempotencyKey, err },
      'deposit failed: stripe intent creation'
    )
    return { error: 'Could not start the deposit. Please try again.' }
  }
}
