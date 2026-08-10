import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth/mfa', () => ({ requireVerifiedMfa: vi.fn() }))
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, enforceRateLimit: vi.fn().mockResolvedValue(true) }
})

import { createClient } from '@/lib/supabase/server'
import { requireVerifiedMfa } from '@/lib/auth/mfa'
import { sendMoney } from '@/app/send/actions'

function mockSupabase(rpc: (fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc }
}

const mockedCreateClient = vi.mocked(createClient)
const mockedRequireVerifiedMfa = vi.mocked(requireVerifiedMfa)

describe('sendMoney', () => {
  it('returns an error when MFA is not verified', async () => {
    mockedRequireVerifiedMfa.mockResolvedValue({ ok: false, error: 'Two-factor verification is required' })
    expect(await sendMoney('a@b.com', 1000)).toHaveProperty('error')
  })

  it('returns an error when the recipient is not found', async () => {
    mockedRequireVerifiedMfa.mockResolvedValue({ ok: true, userId: 'u1' })
    mockedCreateClient.mockResolvedValue(
      mockSupabase(async () => ({ data: null, error: null })) as unknown as Awaited<ReturnType<typeof createClient>>
    )
    expect(await sendMoney('nobody@example.com', 1000)).toHaveProperty('error')
  })

  it('completes the transfer when the recipient exists and the RPC succeeds', async () => {
    mockedRequireVerifiedMfa.mockResolvedValue({ ok: true, userId: 'u1' })
    const rpc = vi.fn(async (fn: string) => {
      if (fn === 'find_recipient_account') return { data: 'acct-2', error: null }
      if (fn === 'transfer_funds') return { data: { transaction_id: 'txn-1', status: 'completed' }, error: null }
      return { data: null, error: null }
    })
    mockedCreateClient.mockResolvedValue(mockSupabase(rpc) as unknown as Awaited<ReturnType<typeof createClient>>)

    expect(await sendMoney('friend@example.com', 1000)).toEqual({ status: 'completed' })
  })
})
