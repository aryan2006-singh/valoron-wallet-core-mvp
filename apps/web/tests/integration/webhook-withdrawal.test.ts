import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/webhooks/stripe/route'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser, fundAccount } from './helpers/create-verified-user'

const admin = createAdminClient()

function buildPayoutEvent(type: string, transactionId: string, eventId: string) {
  const body = JSON.stringify({
    id: eventId,
    type,
    data: { object: { id: `po_test_${eventId}`, metadata: { transaction_id: transactionId } } },
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

describe('withdrawal webhook handling', () => {
  it('completes the transaction on payout.paid', async () => {
    const user = await createVerifiedUser('withdraw-webhook-ok')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)
    const { data: withdrawal } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 5000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })

    const response = await POST(
      buildPayoutEvent('payout.paid', withdrawal.transaction_id, `evt_payout_ok_${Date.now()}`)
    )
    expect(response.status).toBe(200)

    const { data: txn } = await admin
      .from('transactions')
      .select('status')
      .eq('id', withdrawal.transaction_id)
      .single()
    expect(txn?.status).toBe('completed')
  })

  it('reverses the ledger debit on payout.failed', async () => {
    const user = await createVerifiedUser('withdraw-webhook-fail')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)
    const { data: withdrawal } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 5000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })

    const response = await POST(
      buildPayoutEvent('payout.failed', withdrawal.transaction_id, `evt_payout_fail_${Date.now()}`)
    )
    expect(response.status).toBe(200)

    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(10000)
  })
})
