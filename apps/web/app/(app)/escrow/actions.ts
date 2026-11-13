'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { escrowSchema } from '@/lib/validation/wallet'
import { escrowRateLimit, enforceRateLimit } from '@/lib/rate-limit'
import { requireVerifiedMfa } from '@/lib/auth/mfa'
import { logger, maskEmail } from '@/lib/logger'

const escrowLog = logger.child({ area: 'escrow' })

type Result = { status: 'completed' | 'already_processed' } | { error: string }

export async function createEscrow(
  recipientEmail: string,
  amountCents: number,
  description?: string
): Promise<Result> {
  const parsed = escrowSchema.safeParse({ recipientEmail, amountCents, description })
  if (!parsed.success) {
    escrowLog.info({ amountCents, reason: parsed.error.issues[0].message }, 'escrow rejected: validation failed')
    return { error: parsed.error.issues[0].message }
  }
  const recipient = maskEmail(parsed.data.recipientEmail)

  const mfa = await requireVerifiedMfa()
  if (!mfa.ok) {
    escrowLog.warn({ recipient, amountCents, reason: mfa.error }, 'escrow denied: MFA not satisfied')
    return { error: mfa.error }
  }

  if (!(await enforceRateLimit(escrowRateLimit, mfa.userId))) {
    escrowLog.warn({ userId: mfa.userId, recipient, amountCents }, 'escrow blocked: rate limit exceeded')
    return { error: 'Too many escrow attempts. Try again in a minute.' }
  }

  const supabase = await createClient()
  const { data: recipientAccountId, error: lookupError } = await supabase.rpc('find_recipient_account', {
    p_email: parsed.data.recipientEmail,
  })
  if (lookupError) {
    escrowLog.error({ userId: mfa.userId, recipient, err: lookupError.message }, 'escrow failed: recipient lookup')
    return { error: lookupError.message }
  }
  if (!recipientAccountId) return { error: 'No Valoron user found with that email' }

  const idempotencyKey = `escrow-fund-${randomUUID()}`
  const { error } = await supabase.rpc('fund_escrow', {
    p_recipient_account_id: recipientAccountId,
    p_amount_cents: parsed.data.amountCents,
    p_description: parsed.data.description ?? '',
    p_idempotency_key: idempotencyKey,
  })
  if (error) {
    escrowLog.error({ userId: mfa.userId, recipient, amountCents, idempotencyKey, err: error.message }, 'escrow funding failed')
    return { error: error.message }
  }

  escrowLog.info({ userId: mfa.userId, recipient, amountCents, idempotencyKey }, 'escrow funded')
  revalidatePath('/escrow')
  revalidatePath('/dashboard')
  return { status: 'completed' }
}

async function resolve(escrowId: string, fn: 'release_escrow' | 'refund_escrow'): Promise<Result> {
  if (!/^[0-9a-f-]{36}$/i.test(escrowId)) return { error: 'Invalid escrow' }

  const mfa = await requireVerifiedMfa()
  if (!mfa.ok) {
    escrowLog.warn({ escrowId, fn, reason: mfa.error }, 'escrow resolve denied: MFA not satisfied')
    return { error: mfa.error }
  }
  if (!(await enforceRateLimit(escrowRateLimit, mfa.userId))) {
    return { error: 'Too many escrow attempts. Try again in a minute.' }
  }

  const supabase = await createClient()
  const idempotencyKey = `${fn}-${randomUUID()}`
  const { error } = await supabase.rpc(fn, { p_escrow_id: escrowId, p_idempotency_key: idempotencyKey })
  if (error) {
    escrowLog.error({ userId: mfa.userId, escrowId, fn, err: error.message }, 'escrow resolve failed')
    return { error: error.message }
  }

  escrowLog.info({ userId: mfa.userId, escrowId, fn }, 'escrow resolved')
  revalidatePath('/escrow')
  revalidatePath('/dashboard')
  return { status: 'completed' }
}

export async function releaseEscrow(escrowId: string): Promise<Result> {
  return resolve(escrowId, 'release_escrow')
}

export async function refundEscrow(escrowId: string): Promise<Result> {
  return resolve(escrowId, 'refund_escrow')
}
