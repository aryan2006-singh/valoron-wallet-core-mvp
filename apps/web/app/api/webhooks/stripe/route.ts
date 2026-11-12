import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type Stripe from 'stripe'
import type { Json } from '@/types/supabase'

// supabase-js reports database failures as `{ error }` instead of throwing,
// so every handler funnels its result through this. A handler that
// silently swallowed an error would let the route answer 200, and Stripe
// would never redeliver an event whose money movement never happened.
function assertOk(result: { error: { message: string; code?: string } | null }, what: string) {
  if (result.error) {
    throw new Error(`${what} failed: ${result.error.message} (${result.error.code ?? 'no code'})`)
  }
}

async function handleIdentityVerified(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const session = event.data.object as Stripe.Identity.VerificationSession
  const userId = session.metadata?.user_id
  if (!userId) return
  assertOk(await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', userId), 'kyc verified update')
}

async function handleIdentityRequiresInput(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const session = event.data.object as Stripe.Identity.VerificationSession
  const userId = session.metadata?.user_id
  if (!userId) return
  assertOk(await admin.from('profiles').update({ kyc_status: 'rejected' }).eq('id', userId), 'kyc rejected update')
}

async function handleDepositSucceeded(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const paymentIntent = event.data.object as Stripe.PaymentIntent
  const accountId = paymentIntent.metadata?.account_id
  const idempotencyKey = paymentIntent.metadata?.idempotency_key
  if (!accountId || !idempotencyKey) return

  assertOk(
    await admin.rpc('record_deposit', {
      p_account_id: accountId,
      p_amount_cents: paymentIntent.amount,
      p_stripe_reference: paymentIntent.id,
      p_idempotency_key: idempotencyKey,
    }),
    'record_deposit'
  )
}

async function handlePayoutPaid(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout
  const transactionId = payout.metadata?.transaction_id
  if (!transactionId) return
  // Failing here means Stripe paid out a withdrawal we no longer consider
  // pending (already reversed, or unknown). That is money out the door with
  // no matching ledger state, so it must surface as an error, not a 200.
  assertOk(
    await admin.rpc('confirm_withdrawal', { p_transaction_id: transactionId, p_stripe_reference: payout.id }),
    'confirm_withdrawal'
  )
}

async function handlePayoutFailed(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout
  const transactionId = payout.metadata?.transaction_id
  if (!transactionId) return
  assertOk(
    await admin.rpc('reverse_withdrawal', { p_transaction_id: transactionId, p_reason: 'stripe_payout_failed' }),
    'reverse_withdrawal'
  )
}

export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature ?? '', process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    logger.warn({ err }, 'stripe webhook: invalid signature')
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  // SECURITY: this is the one file in the app allowed to hold the
  // service-role key — see Global Constraints in this plan's header.
  const admin = createAdminClient()

  // Dedupe check only. The event is recorded as processed AFTER its
  // handler succeeds (below): recording it first meant a handler that
  // failed once left the event marked done, so Stripe's retry was deduped
  // and the deposit/payout update was lost for good. Concurrent duplicate
  // deliveries that both get past this check are safe because every
  // handler is idempotent at the database level (record_deposit's
  // idempotency key, the status guards in confirm/reverse_withdrawal).
  const { data: seen, error: seenError } = await admin
    .from('webhook_events')
    .select('id')
    .eq('id', event.id)
    .maybeSingle()

  if (seenError) {
    logger.error({ err: seenError, eventId: event.id }, 'stripe webhook: failed to check dedupe log')
    Sentry.captureException(seenError)
    return NextResponse.json({ error: 'Failed to check webhook event' }, { status: 500 })
  }

  if (seen) {
    logger.info({ eventId: event.id, type: event.type }, 'stripe webhook: deduped replayed event')
    return NextResponse.json({ received: true, deduped: true })
  }

  logger.info({ eventId: event.id, type: event.type }, 'stripe webhook: processing event')

  try {
    switch (event.type) {
      case 'identity.verification_session.verified':
        await handleIdentityVerified(admin, event)
        break
      case 'identity.verification_session.requires_input':
        await handleIdentityRequiresInput(admin, event)
        break
      case 'payment_intent.succeeded':
        await handleDepositSucceeded(admin, event)
        break
      case 'payout.paid':
        await handlePayoutPaid(admin, event)
        break
      case 'payout.failed':
        await handlePayoutFailed(admin, event)
        break
      default:
        break
    }
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, 'stripe webhook: handler failed')
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  const { error: recordError } = await admin
    .from('webhook_events')
    .insert({ id: event.id, type: event.type, payload: event as unknown as Json })

  // 23505: a concurrent delivery of this same event finished first. The
  // work is done either way, so that is still a success.
  if (recordError && recordError.code !== '23505') {
    // The handler's effects are committed and idempotent, so a 500 here
    // just makes Stripe redeliver; the replay is then a no-op.
    logger.error({ err: recordError, eventId: event.id }, 'stripe webhook: failed to record event')
    Sentry.captureException(recordError)
    return NextResponse.json({ error: 'Failed to record webhook event' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
