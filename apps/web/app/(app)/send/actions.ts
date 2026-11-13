'use server'

import { createClient } from '@/lib/supabase/server'
import { transferSchema } from '@/lib/validation/wallet'
import { transferRateLimit, enforceRateLimit } from '@/lib/rate-limit'
import { requireVerifiedMfa } from '@/lib/auth/mfa'
import { logger, maskEmail } from '@/lib/logger'
import { categorizeNote } from '@/lib/ai/categories'
import { emitN8nEvent } from '@/lib/n8n'

// Money movement is logged at every decision point, not just on success:
// a refused transfer is exactly as interesting as a completed one when
// reconstructing what happened to an account.
const transferLog = logger.child({ area: 'transfer' })

export async function sendMoney(
  recipientEmail: string,
  amountCents: number,
  note?: string
): Promise<{ status: 'completed' } | { error: string }> {
  const parsed = transferSchema.safeParse({ recipientEmail, amountCents, note })
  if (!parsed.success) {
    transferLog.info({ amountCents, reason: parsed.error.issues[0].message }, 'transfer rejected: validation failed')
    return { error: parsed.error.issues[0].message }
  }

  const recipient = maskEmail(parsed.data.recipientEmail)

  const mfa = await requireVerifiedMfa()
  if (!mfa.ok) {
    transferLog.warn({ recipient, amountCents, reason: mfa.error }, 'transfer denied: MFA not satisfied')
    return { error: mfa.error }
  }

  const allowed = await enforceRateLimit(transferRateLimit, mfa.userId)
  if (!allowed) {
    transferLog.warn({ userId: mfa.userId, recipient, amountCents }, 'transfer blocked: rate limit exceeded')
    return { error: 'Too many transfer attempts. Try again in a minute.' }
  }

  const supabase = await createClient()

  const { data: recipientAccountId, error: lookupError } = await supabase.rpc('find_recipient_account', {
    p_email: parsed.data.recipientEmail,
  })
  if (lookupError) {
    transferLog.error({ userId: mfa.userId, recipient, err: lookupError.message }, 'transfer failed: recipient lookup')
    return { error: lookupError.message }
  }
  if (!recipientAccountId) {
    transferLog.info({ userId: mfa.userId, recipient }, 'transfer rejected: recipient not found')
    return { error: 'No Valoron user found with that email' }
  }

  const idempotencyKey = `transfer-${mfa.userId}-${Date.now()}`
  const transferNote = parsed.data.note || null
  const category = categorizeNote(transferNote)
  transferLog.info(
    { userId: mfa.userId, recipient, amountCents: parsed.data.amountCents, idempotencyKey },
    'transfer initiated'
  )

  const { error } = await supabase.rpc('transfer_funds', {
    p_recipient_account_id: recipientAccountId,
    p_amount_cents: parsed.data.amountCents,
    p_idempotency_key: idempotencyKey,
    p_note: transferNote,
    p_category: category,
  })
  if (error) {
    transferLog.error(
      { userId: mfa.userId, recipient, amountCents: parsed.data.amountCents, idempotencyKey, err: error.message },
      'transfer failed'
    )
    return { error: error.message }
  }

  transferLog.info(
    { userId: mfa.userId, recipient, amountCents: parsed.data.amountCents, idempotencyKey, category },
    'transfer completed'
  )

  // Fire-and-forget: n8n automations (alerts, digests) must never slow down
  // or fail a transfer that has already committed.
  void emitN8nEvent('transfer.completed', {
    userId: mfa.userId,
    userEmail: mfa.email ?? null,
    recipient,
    amountCents: parsed.data.amountCents,
    note: transferNote,
    category,
  })
  return { status: 'completed' }
}
