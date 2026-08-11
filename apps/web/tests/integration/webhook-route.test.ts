import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/webhooks/stripe/route'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'

const admin = createAdminClient()

function buildSignedRequest(eventId: string, type = 'test.unhandled_event') {
  const body = JSON.stringify({ id: eventId, type, data: { object: {} } })
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

describe('Stripe webhook route', () => {
  it('rejects a request with an invalid signature', async () => {
    const request = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'invalid', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'evt_bad', type: 'test.event' }),
    })
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  it('accepts a validly signed event and records it for dedupe', async () => {
    const eventId = `evt_test_${Date.now()}`
    const response = await POST(buildSignedRequest(eventId))
    expect(response.status).toBe(200)

    const { data } = await admin.from('webhook_events').select('id').eq('id', eventId).single()
    expect(data?.id).toBe(eventId)
  })

  it('deduplicates a replayed event instead of reprocessing it', async () => {
    const eventId = `evt_test_${Date.now()}`
    const first = await POST(buildSignedRequest(eventId))
    const second = await POST(buildSignedRequest(eventId))
    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect((await second.json()).deduped).toBe(true)
  })
})
