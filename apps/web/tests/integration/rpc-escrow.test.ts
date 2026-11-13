import { describe, it, expect } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser, fundAccount } from './helpers/create-verified-user'

const admin = createAdminClient()
const key = (p: string) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2)}`

async function balance(accountId: string) {
  const { data } = await admin
    .from('ledger_entries')
    .select('amount_cents, direction')
    .eq('account_id', accountId)
  return (data ?? []).reduce((s, e) => s + (e.direction === 'credit' ? e.amount_cents : -e.amount_cents), 0)
}

async function setup(funding = 10_000) {
  const funder = await createVerifiedUser('funder')
  const recipient = await createVerifiedUser('recipient')
  await fundAccount(funder.accountId, funding)
  return { funder, recipient }
}

async function fund(funder: Awaited<ReturnType<typeof setup>>['funder'], recipientAccountId: string, cents = 4000) {
  const { data, error } = await funder.client.rpc('fund_escrow', {
    p_recipient_account_id: recipientAccountId,
    p_amount_cents: cents,
    p_description: 'test job',
    p_idempotency_key: key('fund'),
  })
  expect(error).toBeNull()
  return data.escrow_id as string
}

describe('fund_escrow', () => {
  it('moves the amount out of the funder balance into a held escrow', async () => {
    const { funder, recipient } = await setup()
    const id = await fund(funder, recipient.accountId)

    expect(await balance(funder.accountId)).toBe(6000)
    expect(await balance(recipient.accountId)).toBe(0)
    const { data } = await funder.client.from('escrows').select('status, amount_cents').eq('id', id).single()
    expect(data).toEqual({ status: 'held', amount_cents: 4000 })
  })

  it('rejects an amount above the balance', async () => {
    const { funder, recipient } = await setup(1000)
    const { error } = await funder.client.rpc('fund_escrow', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 5000,
      p_description: '',
      p_idempotency_key: key('fund'),
    })
    expect(error?.message).toMatch(/insufficient balance/i)
  })

  it('rejects escrowing to your own account', async () => {
    const { funder } = await setup()
    const { error } = await funder.client.rpc('fund_escrow', {
      p_recipient_account_id: funder.accountId,
      p_amount_cents: 100,
      p_description: '',
      p_idempotency_key: key('fund'),
    })
    expect(error).not.toBeNull()
  })

  it('is idempotent: replaying a key does not hold funds twice', async () => {
    const { funder, recipient } = await setup()
    const k = key('fund')
    const args = {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 1000,
      p_description: '',
      p_idempotency_key: k,
    }
    await funder.client.rpc('fund_escrow', args)
    const { data } = await funder.client.rpc('fund_escrow', args)
    expect(data.status).toBe('already_processed')
    expect(await balance(funder.accountId)).toBe(9000)
  })

  it('refuses a key already used by a different transaction type', async () => {
    const { funder, recipient } = await setup()
    const { data: dep } = await admin.from('transactions').select('idempotency_key').eq('type', 'deposit').limit(1).single()
    const { error } = await funder.client.rpc('fund_escrow', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 100,
      p_description: '',
      p_idempotency_key: dep!.idempotency_key,
    })
    expect(error?.message).toMatch(/idempotency key already used/i)
  })
})

describe('release_escrow', () => {
  it('credits the recipient and only the funder may release', async () => {
    const { funder, recipient } = await setup()
    const id = await fund(funder, recipient.accountId)

    const bad = await recipient.client.rpc('release_escrow', { p_escrow_id: id, p_idempotency_key: key('rel') })
    expect(bad.error?.message).toMatch(/only the funder/i)

    const ok = await funder.client.rpc('release_escrow', { p_escrow_id: id, p_idempotency_key: key('rel') })
    expect(ok.error).toBeNull()
    expect(await balance(recipient.accountId)).toBe(4000)
    expect(await balance(funder.accountId)).toBe(6000)
  })

  it('cannot be resolved twice, even concurrently', async () => {
    const { funder, recipient } = await setup()
    const id = await fund(funder, recipient.accountId)

    const results = await Promise.all([
      funder.client.rpc('release_escrow', { p_escrow_id: id, p_idempotency_key: key('rel') }),
      funder.client.rpc('release_escrow', { p_escrow_id: id, p_idempotency_key: key('rel') }),
    ])
    expect(results.filter((r) => !r.error)).toHaveLength(1)
    expect(await balance(recipient.accountId)).toBe(4000)
  })

  it('cannot release after a refund', async () => {
    const { funder, recipient } = await setup()
    const id = await fund(funder, recipient.accountId)
    await recipient.client.rpc('refund_escrow', { p_escrow_id: id, p_idempotency_key: key('ref') })
    const { error } = await funder.client.rpc('release_escrow', { p_escrow_id: id, p_idempotency_key: key('rel') })
    expect(error?.message).toMatch(/already refunded/i)
  })
})

describe('refund_escrow', () => {
  it('lets the recipient decline at any time, returning funds to the funder', async () => {
    const { funder, recipient } = await setup()
    const id = await fund(funder, recipient.accountId)
    const { error } = await recipient.client.rpc('refund_escrow', { p_escrow_id: id, p_idempotency_key: key('ref') })
    expect(error).toBeNull()
    expect(await balance(funder.accountId)).toBe(10_000)
    expect(await balance(recipient.accountId)).toBe(0)
  })

  it('blocks the funder from refunding before the escrow expires', async () => {
    // The after-expiry path needs expires_at in the past, which no client or
    // service-role grant can write by design; it is exercised by hand in SQL.
    const { funder, recipient } = await setup()
    const id = await fund(funder, recipient.accountId)
    const early = await funder.client.rpc('refund_escrow', { p_escrow_id: id, p_idempotency_key: key('ref') })
    expect(early.error?.message).toMatch(/only after the escrow expires/i)
    expect(await balance(funder.accountId)).toBe(6000)
  })

  it('rejects a stranger', async () => {
    const { funder, recipient } = await setup()
    const stranger = await createVerifiedUser('stranger')
    const id = await fund(funder, recipient.accountId)
    const { error } = await stranger.client.rpc('refund_escrow', { p_escrow_id: id, p_idempotency_key: key('ref') })
    expect(error?.message).toMatch(/not a party/i)
  })
})

describe('escrows visibility', () => {
  it('only the two parties can read an escrow; my_escrows names the counterparty', async () => {
    const { funder, recipient } = await setup()
    const stranger = await createVerifiedUser('stranger')
    const id = await fund(funder, recipient.accountId)

    const seen = await stranger.client.from('escrows').select('id').eq('id', id)
    expect(seen.data).toEqual([])

    const { data } = await recipient.client.rpc('my_escrows')
    expect(data).toHaveLength(1)
    expect(data![0]).toMatchObject({ id, role: 'recipient', status: 'held', can_refund: true })
    const { data: mine } = await funder.client.rpc('my_escrows')
    expect(mine![0]).toMatchObject({ role: 'funder', can_refund: false })
  })

  it('clients cannot write escrows directly', async () => {
    const { funder, recipient } = await setup()
    const id = await fund(funder, recipient.accountId)
    const { error } = await funder.client.from('escrows').update({ status: 'released' }).eq('id', id)
    expect(error).not.toBeNull()
  })
})
