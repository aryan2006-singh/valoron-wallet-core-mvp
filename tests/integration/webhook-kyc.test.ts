import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/webhooks/stripe/route'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser } from './helpers/create-verified-user'

const admin = createAdminClient()

function buildIdentityEvent(type: string, userId: string, eventId: string) {
  const body = JSON.stringify({
    id: eventId,
    type,
    data: { object: { id: 'vs_test_123', metadata: { user_id: userId } } },
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

describe('Stripe Identity webhook handling', () => {
  it('marks a profile verified on identity.verification_session.verified', async () => {
    const user = await createVerifiedUser('kyc-webhook')
    const response = await POST(
      buildIdentityEvent('identity.verification_session.verified', user.userId, `evt_kyc_ok_${Date.now()}`)
    )
    expect(response.status).toBe(200)

    const { data: profile } = await admin.from('profiles').select('kyc_status').eq('id', user.userId).single()
    expect(profile?.kyc_status).toBe('verified')
  })

  it('marks a profile rejected on identity.verification_session.requires_input', async () => {
    const user = await createVerifiedUser('kyc-webhook-fail')
    const response = await POST(
      buildIdentityEvent('identity.verification_session.requires_input', user.userId, `evt_kyc_fail_${Date.now()}`)
    )
    expect(response.status).toBe(200)

    const { data: profile } = await admin.from('profiles').select('kyc_status').eq('id', user.userId).single()
    expect(profile?.kyc_status).toBe('rejected')
  })
})
