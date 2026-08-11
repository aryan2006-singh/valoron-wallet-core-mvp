import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/webhooks/stripe/route'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser } from './helpers/create-verified-user'

const admin = createAdminClient()

function buildPaymentIntentEvent(accountId: string, amountCents: number, idempotencyKey: string, eventId: string) {
  const body = JSON.stringify({
    id: eventId,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: `pi_test_${eventId}`,
        amount: amountCents,
        metadata: { account_id: accountId, idempotency_key: idempotencyKey },
      },
    },
  })
  const signature = stripe.webhooks.generateTestHeaderString({
    payload: body,
    secret: process.env.STRIPE_WEBHOOK_SECRET!,
  })
  return new Request('http://localhost/api/webhooks/stripe', {
    method: 'POST',
    headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
    body,
  })
}

describe('deposit webhook handling', () => {
  it('credits the ledger when payment_intent.succeeded arrives', async () => {
    const user = await createVerifiedUser('depositor-webhook')
    const idempotencyKey = `deposit-${user.accountId}-${Date.now()}`

    const response = await POST(
      buildPaymentIntentEvent(user.accountId, 3000, idempotencyKey, `evt_deposit_${Date.now()}`)
    )
    expect(response.status).toBe(200)

    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(3000)
  })
})
