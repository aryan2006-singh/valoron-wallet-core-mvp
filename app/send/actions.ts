'use server'

import { createClient } from '@/lib/supabase/server'
import { transferSchema } from '@/lib/validation/wallet'
import { transferRateLimit, enforceRateLimit } from '@/lib/rate-limit'
import { requireVerifiedMfa } from '@/lib/auth/mfa'

export async function sendMoney(
  recipientEmail: string,
  amountCents: number
): Promise<{ status: 'completed' } | { error: string }> {
  const parsed = transferSchema.safeParse({ recipientEmail, amountCents })
  if (!parsed.success) return { error: parsed.error.issues[0].message }

  const mfa = await requireVerifiedMfa()
  if (!mfa.ok) return { error: mfa.error }

  const allowed = await enforceRateLimit(transferRateLimit, mfa.userId)
  if (!allowed) return { error: 'Too many transfer attempts. Try again in a minute.' }

  const supabase = await createClient()

  const { data: recipientAccountId, error: lookupError } = await supabase.rpc('find_recipient_account', {
    p_email: parsed.data.recipientEmail,
  })
  if (lookupError) return { error: lookupError.message }
  if (!recipientAccountId) return { error: 'No Valoron user found with that email' }

  const idempotencyKey = `transfer-${mfa.userId}-${Date.now()}`
  const { error } = await supabase.rpc('transfer_funds', {
    p_recipient_account_id: recipientAccountId,
    p_amount_cents: parsed.data.amountCents,
    p_idempotency_key: idempotencyKey,
  })
  if (error) return { error: error.message }

  return { status: 'completed' }
}
