import { describe, it, expect } from 'vitest'
import { createVerifiedUser, fundAccount } from './helpers/create-verified-user'

describe('transfer notes and categories', () => {
  it('stores the note and category, visible to both sender and recipient', async () => {
    const sender = await createVerifiedUser('note-sender')
    const recipient = await createVerifiedUser('note-recipient')
    await fundAccount(sender.accountId, 5000)

    const { data, error } = await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 1500,
      p_idempotency_key: `transfer-note-${Date.now()}`,
      p_note: '  Pizza night  ',
      p_category: 'food',
    })
    expect(error).toBeNull()
    const txnId = (data as { transaction_id: string }).transaction_id

    for (const party of [sender, recipient]) {
      const { data: row } = await party.client.from('transactions').select('note, category').eq('id', txnId).single()
      expect(row).toEqual({ note: 'Pizza night', category: 'food' })
    }
  })

  it('still accepts the original three-argument call', async () => {
    const sender = await createVerifiedUser('note-legacy')
    const recipient = await createVerifiedUser('note-legacy-r')
    await fundAccount(sender.accountId, 5000)
    const { data, error } = await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 100,
      p_idempotency_key: `transfer-legacy-${Date.now()}`,
    })
    expect(error).toBeNull()
    const { data: row } = await sender.client
      .from('transactions')
      .select('note, category')
      .eq('id', (data as { transaction_id: string }).transaction_id)
      .single()
    expect(row).toEqual({ note: null, category: null })
  })

  it('rejects an unknown category and moves no money', async () => {
    const sender = await createVerifiedUser('note-badcat')
    const recipient = await createVerifiedUser('note-badcat-r')
    await fundAccount(sender.accountId, 5000)
    const { error } = await sender.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 100,
      p_idempotency_key: `transfer-badcat-${Date.now()}`,
      p_category: 'crypto',
    })
    expect(error).not.toBeNull()
    const { data: entries } = await sender.client
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', sender.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(5000)
  })
})

describe('weekly_insights row-level security', () => {
  it('lets a user write and read only their own insight', async () => {
    const alice = await createVerifiedUser('insight-a')
    const bob = await createVerifiedUser('insight-b')

    const { error: ownError } = await alice.client
      .from('weekly_insights')
      .insert({ user_id: alice.userId, week_start: '2026-11-09', summary: 'Quiet week.' })
    expect(ownError).toBeNull()

    const { error: forgeError } = await alice.client
      .from('weekly_insights')
      .insert({ user_id: bob.userId, week_start: '2026-11-09', summary: 'forged' })
    expect(forgeError).not.toBeNull()

    const { data: bobView } = await bob.client.from('weekly_insights').select('summary')
    expect(bobView).toEqual([])
  })
})
