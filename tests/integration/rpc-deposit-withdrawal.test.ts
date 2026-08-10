import { describe, it, expect } from 'vitest'
import { createAdminClient } from '@/lib/supabase/admin'
import { createVerifiedUser, fundAccount } from './helpers/create-verified-user'

const admin = createAdminClient()

// The generated Supabase types can only say these SECURITY DEFINER RPCs
// return `Json` (Postgres doesn't expose a jsonb function's shape to the
// type generator) — unlike `tests/integration/helpers/create-verified-user.ts`'s
// per-user `client`, which is constructed without the `Database` generic
// and so is untyped at the call site. `admin` (this file) IS built with
// `createAdminClient<Database>()`, so its `.rpc()` calls are properly
// typed as `Json | null`. This narrow cast documents the known shape of
// each RPC's return payload for the handful of call sites here that read
// `.status`/`.transaction_id` off an `admin.rpc(...)` result — it changes
// no runtime behavior, only satisfies `npm run typecheck`.
type RpcResult = { transaction_id: string; status: string; account_id?: string }

describe('record_deposit RPC', () => {
  it('credits the account and is idempotent', async () => {
    const user = await createVerifiedUser('depositor')
    const key = `deposit-${Date.now()}`

    const { data, error } = await admin.rpc('record_deposit', {
      p_account_id: user.accountId,
      p_amount_cents: 4000,
      p_stripe_reference: 'pi_test_123',
      p_idempotency_key: key,
    })
    expect(error).toBeNull()
    expect((data as RpcResult).status).toBe('completed')

    const { data: replay } = await admin.rpc('record_deposit', {
      p_account_id: user.accountId,
      p_amount_cents: 4000,
      p_stripe_reference: 'pi_test_123',
      p_idempotency_key: key,
    })
    expect((replay as RpcResult).status).toBe('already_processed')

    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(4000)
  })

  it('cannot be called by an authenticated (non-service-role) client', async () => {
    const user = await createVerifiedUser('depositor')
    const { error } = await user.client.rpc('record_deposit', {
      p_account_id: user.accountId,
      p_amount_cents: 1000,
      p_stripe_reference: 'pi_test_456',
      p_idempotency_key: `deposit-${Date.now()}`,
    })
    expect(error).not.toBeNull()
  })
})

describe('record_withdrawal / confirm_withdrawal / reverse_withdrawal RPCs', () => {
  it('debits as pending, then confirm_withdrawal completes it', async () => {
    const user = await createVerifiedUser('withdrawer')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)

    const { data: withdrawal, error } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 5000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })
    expect(error).toBeNull()
    expect(withdrawal.status).toBe('pending')

    const { data: confirmed } = await admin.rpc('confirm_withdrawal', {
      p_transaction_id: withdrawal.transaction_id,
      p_stripe_reference: 'po_test_123',
    })
    expect((confirmed as RpcResult).status).toBe('completed')
  })

  it('reverse_withdrawal credits the money back and marks the transaction reversed', async () => {
    const user = await createVerifiedUser('withdrawer')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)

    const { data: withdrawal } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 4000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })

    await admin.rpc('reverse_withdrawal', {
      p_transaction_id: withdrawal.transaction_id,
      p_reason: 'payout_failed',
    })

    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(10000)
  })

  it('lets a user reverse (cancel) their own pending withdrawal directly', async () => {
    const user = await createVerifiedUser('self-canceller')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)

    const { data: withdrawal } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 4000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })

    const { data: reversed, error } = await user.client.rpc('reverse_withdrawal', {
      p_transaction_id: withdrawal.transaction_id,
      p_reason: 'user_cancelled',
    })
    expect(error).toBeNull()
    expect(reversed.status).toBe('reversed')
  })

  it('blocks a user from reversing someone else\'s pending withdrawal', async () => {
    const owner = await createVerifiedUser('withdrawal-owner')
    const intruder = await createVerifiedUser('withdrawal-intruder')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', owner.userId)
    await fundAccount(owner.accountId, 10000)

    const { data: withdrawal } = await owner.client.rpc('record_withdrawal', {
      p_amount_cents: 4000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })

    const { error } = await intruder.client.rpc('reverse_withdrawal', {
      p_transaction_id: withdrawal.transaction_id,
      p_reason: 'not_my_withdrawal',
    })
    expect(error).not.toBeNull()
  })

  it('blocks withdrawals over the $100 pre-KYC cap for unverified users', async () => {
    const user = await createVerifiedUser('unverified-withdrawer')
    await fundAccount(user.accountId, 20000)

    const { error } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 15000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/kyc/i)
  })

  it('allows a small withdrawal under the pre-KYC cap for unverified users', async () => {
    const user = await createVerifiedUser('small-withdrawer')
    await fundAccount(user.accountId, 20000)

    const { data, error } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 5000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })
    expect(error).toBeNull()
    expect(data.status).toBe('pending')
  })

  it('rejects a withdrawal that exceeds the account balance', async () => {
    const user = await createVerifiedUser('overdrawer')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 1000)

    const { error } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 5000,
      p_idempotency_key: `withdraw-${Date.now()}`,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/insufficient balance/i)
  })

  // --- Additional tests beyond the brief's Step 1 list ---
  //
  // These four tests are NOT in the task-6 brief. They were added
  // proactively, mirroring the two tests Task 5's fix round added for
  // transfer_funds, to prove the idempotency-ownership + type-binding +
  // TOCTOU-race-recovery pattern actually works for record_withdrawal
  // rather than just being present in the SQL. See the migration's inline
  // comments for the mechanism.

  it('is idempotent: replaying the same key does not double-withdraw', async () => {
    const user = await createVerifiedUser('withdraw-replay')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)
    const key = `withdraw-replay-${Date.now()}`

    const { data: first, error: firstError } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 3000,
      p_idempotency_key: key,
    })
    expect(firstError).toBeNull()
    expect(first.status).toBe('pending')

    const { data: second, error: secondError } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 3000,
      p_idempotency_key: key,
    })
    expect(secondError).toBeNull()
    expect(second.status).toBe('already_processed')
    expect(second.transaction_id).toBe(first.transaction_id)

    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    // Exactly one debit of 3000 applied against the funded 10000 balance,
    // not two (which would be 4000 if the replay double-withdrew).
    expect(entries?.[0].balance_after_cents).toBe(7000)
  })

  it('rejects replaying an idempotency key that belongs to a different withdrawer', async () => {
    const withdrawerA = await createVerifiedUser('withdraw-ownerA')
    const withdrawerB = await createVerifiedUser('withdraw-ownerB')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', withdrawerA.userId)
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', withdrawerB.userId)
    await fundAccount(withdrawerA.accountId, 10000)
    await fundAccount(withdrawerB.accountId, 10000)
    const key = `withdraw-shared-key-${Date.now()}`

    const { data: first, error: firstError } = await withdrawerA.client.rpc('record_withdrawal', {
      p_amount_cents: 1000,
      p_idempotency_key: key,
    })
    expect(firstError).toBeNull()
    expect(first.status).toBe('pending')

    const { data: second, error: secondError } = await withdrawerB.client.rpc('record_withdrawal', {
      p_amount_cents: 1000,
      p_idempotency_key: key,
    })
    expect(second).toBeNull()
    expect(secondError).not.toBeNull()
    expect(secondError!.message).toMatch(/idempotency key already used/i)

    // withdrawerB's balance must be untouched — the collision was
    // rejected, not silently treated as withdrawerB's own withdrawal.
    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', withdrawerB.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(10000)
  })

  it('rejects reusing a transfer\'s idempotency key for a withdrawal by the same user (type-binding)', async () => {
    const user = await createVerifiedUser('withdraw-type-collision')
    const recipient = await createVerifiedUser('withdraw-type-collision-recipient')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)
    const key = `cross-type-key-${Date.now()}`

    // First, the SAME key is used for a p2p_transfer (debits the same
    // account, from the same user) — not a withdrawal.
    const { data: transfer, error: transferError } = await user.client.rpc('transfer_funds', {
      p_recipient_account_id: recipient.accountId,
      p_amount_cents: 1000,
      p_idempotency_key: key,
    })
    expect(transferError).toBeNull()
    expect(transfer.status).toBe('completed')

    // Now the same user calls record_withdrawal with the identical key.
    // A bare "does a debit ledger entry exist for my account under this
    // key" check (no type filter) would wrongly treat this as an
    // already-processed withdrawal. It must instead be rejected as a
    // key collision with a differently-typed transaction.
    const { data: withdrawal, error: withdrawalError } = await user.client.rpc('record_withdrawal', {
      p_amount_cents: 1000,
      p_idempotency_key: key,
    })
    expect(withdrawal).toBeNull()
    expect(withdrawalError).not.toBeNull()
    expect(withdrawalError!.message).toMatch(/idempotency key already used/i)

    // No new withdrawal debit was applied: balance reflects only the
    // 1000 transfer debit against the 10000 funded balance (9000), not a
    // further 1000 "withdrawal" on top of it.
    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(9000)
  })

  it('recovers cleanly when two truly concurrent record_withdrawal calls race on the same idempotency key', async () => {
    const user = await createVerifiedUser('withdraw-race')
    await admin.from('profiles').update({ kyc_status: 'verified' }).eq('id', user.userId)
    await fundAccount(user.accountId, 10000)
    const key = `withdraw-race-${Date.now()}`

    const [resultA, resultB] = await Promise.all([
      user.client.rpc('record_withdrawal', {
        p_amount_cents: 2000,
        p_idempotency_key: key,
      }),
      user.client.rpc('record_withdrawal', {
        p_amount_cents: 2000,
        p_idempotency_key: key,
      }),
    ])

    // Neither call should surface a raw unique-constraint error: both
    // succeed, one as the real withdrawal and one as the idempotent
    // replay, both pointing at the same transaction.
    expect(resultA.error).toBeNull()
    expect(resultB.error).toBeNull()
    const statuses = [resultA.data.status, resultB.data.status].sort()
    expect(statuses).toEqual(['already_processed', 'pending'])
    expect(resultA.data.transaction_id).toBe(resultB.data.transaction_id)

    const { data: entries } = await admin
      .from('ledger_entries')
      .select('balance_after_cents')
      .eq('account_id', user.accountId)
      .order('id', { ascending: false })
      .limit(1)
    expect(entries?.[0].balance_after_cents).toBe(8000)
  })
})
