'use server'

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { depositSchema } from '@/lib/validation/wallet'
import { depositRateLimit, enforceRateLimit } from '@/lib/rate-limit'

export async function createDepositIntent(
  amountCents: number
): Promise<{ clientSecret: string } | { error: string }> {
  const parsed = depositSchema.safeParse({ amountCents })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const { data: account } = await supabase.from('accounts').select('id').eq('user_id', user.id).single()
  if (!account) return { error: 'Account not found' }

  const allowed = await enforceRateLimit(depositRateLimit, user.id)
  if (!allowed) return { error: 'Too many deposit attempts. Try again later.' }

  const idempotencyKey = `deposit-${account.id}-${Date.now()}`
  const paymentIntent = await stripe.paymentIntents.create(
    {
      amount: parsed.data.amountCents,
      currency: 'usd',
      metadata: { account_id: account.id, idempotency_key: idempotencyKey },
    },
    { idempotencyKey }
  )

  return { clientSecret: paymentIntent.client_secret! }
}
