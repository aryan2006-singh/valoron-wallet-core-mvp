import { describe, it, expect } from 'vitest'
import { POST } from '@/app/api/webhooks/stripe/route'
import { stripe } from '@/lib/stripe/client'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser, fundAccount } from './helpers/create-verified-user'

// Regression tests for the backend hardening pass
// (apps/api/supabase/migrations/20261112190000_backend_hardening.sql and
// the matching webhook / server-action changes). Each one failed on the
// code before that pass.

const admin = createAdminClient()

function signedRequest(payload: object) {
  const body = JSON.stringify(payload)
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

function depositEvent(eventId: string, accountId: string, amountCents: number, idempotencyKey: string) {
  return {
    id: eventId,
    type: 'payment_intent.succeeded',
    data: {
      object: {
        id: `pi_test_${eventId}`,
        amount: amountCents,
        metadata: { account_id: accountId, idempotency_key: idempotencyKey },
      },
    },
  }
}

async function balanceOf(accountId: string) {
  const { data } = await admin
    .from('ledger_entries')
    .select('balance_after_cents')
    .eq('account_id', accountId)
    .order('id', { ascending: false })
    .limit(1)
  return data?.[0]?.balance_after_cents ?? 0
}

async function eventRecorded(eventId: string) {
  const { data } = await admin.from('webhook_events').select('id').eq('id', eventId).maybeSingle()
  return data !== null
}

describe('backend hardening', () => {
  it('does not let a user reverse their own pending withdrawal (payout may already be sent)', async () => {
    const user = await createVerifiedUser('reverse-attacker')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)

    const { data: withdrawal } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 4000,
      p_idempotency_key: `withdraw-${crypto.randomUUID()}`,
    })

    // The payout has gone out to Stripe; the user now tries to claw the
    // debit back straight from the browser before payout.paid arrives.
    const { error } = await user.client.rpc('reverse_withdrawal', {
      p_transaction_id: withdrawal.transaction_id,
      p_reason: 'user_cancelled',
    })
    expect(error).not.toBeNull()
    expect(await balanceOf(user.accountId)).toBe(6000)

    // ...and the later payout.paid still confirms it normally.
    const response = await POST(
      signedRequest({
        id: `evt_paid_${crypto.randomUUID()}`,
        type: 'payout.paid',
        data: { object: { id: 'po_test_paid', metadata: { transaction_id: withdrawal.transaction_id } } },
      })
    )
    expect(response.status).toBe(200)
    const { data: txn } = await admin
      .from('transactions')
      .select('status')
      .eq('id', withdrawal.transaction_id)
      .single()
    expect(txn?.status).toBe('completed')
  })

  it('returns 500 and does not mark the event processed when the deposit RPC fails, so a retry is applied', async () => {
    const user = await createVerifiedUser('deposit-retry')
    const eventId = `evt_retry_${crypto.randomUUID()}`
    const key = `deposit-${crypto.randomUUID()}`

    // First delivery fails inside record_deposit (unknown account).
    const failed = await POST(signedRequest(depositEvent(eventId, crypto.randomUUID(), 2500, key)))
    expect(failed.status).toBe(500)
    expect(await eventRecorded(eventId)).toBe(false)

    // Stripe retries the same event id; this time it must be processed,
    // not swallowed as an already-seen duplicate.
    const retried = await POST(signedRequest(depositEvent(eventId, user.accountId, 2500, key)))
    expect(retried.status).toBe(200)
    expect(await eventRecorded(eventId)).toBe(true)
    expect(await balanceOf(user.accountId)).toBe(2500)
  })

  it('credits a deposit exactly once when the same event is delivered 5 times in parallel', async () => {
    const user = await createVerifiedUser('deposit-parallel')
    const eventId = `evt_parallel_${crypto.randomUUID()}`
    const key = `deposit-${crypto.randomUUID()}`

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => POST(signedRequest(depositEvent(eventId, user.accountId, 1500, key))))
    )
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(await balanceOf(user.accountId)).toBe(1500)

    const { count } = await admin
      .from('ledger_entries')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', user.accountId)
    expect(count).toBe(1)
  })

  it('returns 500 (so Stripe retries and alerts) when a payout.paid cannot be applied', async () => {
    const response = await POST(
      signedRequest({
        id: `evt_paid_missing_${crypto.randomUUID()}`,
        type: 'payout.paid',
        data: { object: { id: 'po_test_missing', metadata: { transaction_id: crypto.randomUUID() } } },
      })
    )
    expect(response.status).toBe(500)
  })
})
