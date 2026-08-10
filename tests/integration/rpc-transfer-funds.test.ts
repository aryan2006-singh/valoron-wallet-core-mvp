import { describe, it, expect } from 'vitest'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser, fundAccount } from './helpers/create-verified-user'

describe('transfer_funds RPC', () => {
  it('moves money from sender to recipient', async () => {
    const sender = await createVerifiedUser('sender')
    const recipient = await createVerifiedUser('recipient')
    await fundAccount(sender.accountId, 5000)

    const { data, error } = await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 2000,
      p_idempotency_key: `transfer-${Date.now()}`,
    })
    expect(error).toBeNull()
    expect(data.status).toBe('completed')

    const { data: entries } = await sender.client
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', sender.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(3000)
  })

  it('rejects a transfer that exceeds the sender balance', async () => {
    const sender = await createVerifiedUser('sender')
    const recipient = await createVerifiedUser('recipient')
    await fundAccount(sender.accountId, 1000)

    const { error } = await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 5000,
      p_idempotency_key: `transfer-${Date.now()}`,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/insufficient balance/i)
  })

  it('is idempotent: replaying the same key does not double-spend', async () => {
    const sender = await createVerifiedUser('sender')
    const recipient = await createVerifiedUser('recipient')
    await fundAccount(sender.accountId, 5000)
    const key = `transfer-idempotent-${Date.now()}`

    await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 2000,
      p_idempotency_key: key,
    })
    const { data: second } = await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 2000,
      p_idempotency_key: key,
    })
    expect(second.status).toBe('already_processed')

    const { data: entries } = await sender.client
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', sender.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(3000)
  })

  it('handles two concurrent transfers from the same account without overdrawing it', async () => {
    const sender = await createVerifiedUser('sender')
    const recipientA = await createVerifiedUser('recipientA')
    const recipientB = await createVerifiedUser('recipientB')
    await fundAccount(sender.accountId, 3000) // enough for exactly one of these two 3000 transfers

    const [resultA, resultB] = await Promise.all([
      sender.client.rpc('transfer_funds', {
        p_recipient_account_id: recipientA.accountId,
        p_amount_cents: 3000,
        p_idempotency_key: `concurrent-a-${Date.now()}`,
      }),
      sender.client.rpc('transfer_funds', {
        p_recipient_account_id: recipientB.accountId,
        p_amount_cents: 3000,
        p_idempotency_key: `concurrent-b-${Date.now()}`,
      }),
    ])

    const results = [resultA, resultB]
    expect(results.filter((r) => !r.error).length).toBe(1)
    expect(results.filter((r) => r.error).length).toBe(1)
  })

  it('rejects a transfer when the session has not completed MFA (aal1)', async () => {
    const admin = createAdminClient()
    const email = `no-mfa-${Date.now()}@example.com`
    const password = 'Test1234!'
    await admin.auth.admin.createUser({ email, password, email_confirm: true })

    const client = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    await client.auth.signInWithPassword({ email, password })

    const recipient = await createVerifiedUser('recipient')
    const { error } = await client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 100,
      p_idempotency_key: `no-mfa-${Date.now()}`,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/mfa/i)
  })
})
