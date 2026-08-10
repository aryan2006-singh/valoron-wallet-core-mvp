import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { logger } from '@/lib/logger'
import type Stripe from 'stripe'
import type { Json } from '@/types/supabase'

async function handleIdentityVerified(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const session = event.data.object as Stripe.Identity.VerificationSession
  const userId = session.metadata?.user_id
  if (!userId) return
  await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', userId)
}

async function handleIdentityRequiresInput(admin: ReturnType<typeof createAdminClient>, event: Stripe.Event) {
  const session = event.data.object as Stripe.Identity.VerificationSession
  const userId = session.metadata?.user_id
  if (!userId) return
  await admin.from('profiles').update({ kyc_status: 'rejected' }).eq('id', userId)
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

  const { error: dedupeError } = await admin
    .from('webhook_events')
    .insert({ id: event.id, type: event.type, payload: event as unknown as Json })

  if (dedupeError) {
    if (dedupeError.code === '23505') {
      // Already processed this event id — Stripe retries are expected.
      logger.info({ eventId: event.id, type: event.type }, 'stripe webhook: deduped replayed event')
      return NextResponse.json({ received: true, deduped: true })
    }
    logger.error({ err: dedupeError, eventId: event.id }, 'stripe webhook: failed to record event')
    Sentry.captureException(dedupeError)
    return NextResponse.json({ error: 'Failed to record webhook event' }, { status: 500 })
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
      // Tasks 12-13 add cases here: payment_intent.succeeded, payout.paid,
      // payout.failed.
      default:
        break
    }
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, 'stripe webhook: handler failed')
    Sentry.captureException(err)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
