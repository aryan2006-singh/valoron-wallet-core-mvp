import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/stripe/client', () => ({ stripe: { payouts: { create: vi.fn() } } }))
vi.mock('@/lib/auth/mfa', () => ({ requireVerifiedMfa: vi.fn() }))
vi.mock('@/lib/supabase/withdrawal-reversal', () => ({ reverseFailedWithdrawal: vi.fn() }))
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, enforceRateLimit: vi.fn().mockResolvedValue(true) }
})

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { requireVerifiedMfa } from '@/lib/auth/mfa'
import { reverseFailedWithdrawal } from '@/lib/supabase/withdrawal-reversal'
import { requestWithdrawal } from '@/app/(app)/withdraw/actions'

function mockSupabase(rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc }
}

const mockedCreateClient = vi.mocked(createClient)
const mockedRequireVerifiedMfa = vi.mocked(requireVerifiedMfa)
const mockedCreatePayout = vi.mocked(stripe.payouts.create)
const mockedReverse = vi.mocked(reverseFailedWithdrawal)

describe('requestWithdrawal', () => {
  it('returns an error when MFA is not verified', async () => {
    mockedRequireVerifiedMfa.mockResolvedValue({ ok: false, error: 'Two-factor verification is required' })
    const result = await requestWithdrawal(2000)
    expect(result).toHaveProperty('error')
  })

  it('returns pending when the RPC and payout both succeed', async () => {
    mockedRequireVerifiedMfa.mockResolvedValue({ ok: true, userId: 'u1' })
    mockedCreateClient.mockResolvedValue(
      mockSupabase(async () => ({ data: { transaction_id: 'txn-1', status: 'pending' }, error: null })) as unknown as Awaited<
        ReturnType<typeof createClient>
      >
    )
    mockedCreatePayout.mockResolvedValue(
      { id: 'po_123' } as unknown as Awaited<ReturnType<typeof stripe.payouts.create>>
    )

    expect(await requestWithdrawal(2000)).toEqual({ status: 'pending' })
  })

  it('reverses the ledger debit via the service-role helper and returns an error if the payout call fails', async () => {
    mockedRequireVerifiedMfa.mockResolvedValue({ ok: true, userId: 'u1' })
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'record_withdrawal') return { data: { transaction_id: 'txn-2', status: 'pending' }, error: null }
      return { data: null, error: null }
    })
    mockedCreateClient.mockResolvedValue(mockSupabase(rpc) as unknown as Awaited<ReturnType<typeof createClient>>)
    mockedCreatePayout.mockRejectedValue(new Error('card_declined'))
    mockedReverse.mockResolvedValue({ data: { status: 'reversed' }, error: null } as unknown as Awaited<
      ReturnType<typeof reverseFailedWithdrawal>
    >)

    const result = await requestWithdrawal(2000)
    expect(result).toHaveProperty('error')
    expect(mockedReverse).toHaveBeenCalledWith('txn-2', 'card_declined')
    // Never through the user's own session: that path is revoked.
    expect(rpc).not.toHaveBeenCalledWith('reverse_withdrawal', expect.anything())
  })
})
