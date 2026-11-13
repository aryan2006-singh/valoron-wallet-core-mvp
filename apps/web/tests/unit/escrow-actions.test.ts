import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/auth/mfa', () => ({ requireVerifiedMfa: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, enforceRateLimit: vi.fn().mockResolvedValue(true) }
})

import { createClient } from '@/lib/supabase/server'
import { requireVerifiedMfa } from '@/lib/auth/mfa'
import { enforceRateLimit } from '@/lib/rate-limit'
import { createEscrow, releaseEscrow, refundEscrow } from '@/app/(app)/escrow/actions'

const mockedCreateClient = vi.mocked(createClient)
const mockedMfa = vi.mocked(requireVerifiedMfa)
const mockedRateLimit = vi.mocked(enforceRateLimit)
const ESCROW_ID = '11111111-1111-4111-8111-111111111111'

function useRpc(rpc: (fn: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) {
  mockedCreateClient.mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createClient>>)
  return rpc
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedMfa.mockResolvedValue({ ok: true, userId: 'u1' })
  mockedRateLimit.mockResolvedValue(true)
})

describe('createEscrow', () => {
  it('rejects invalid input before touching the database', async () => {
    expect(await createEscrow('not-an-email', 1000)).toHaveProperty('error')
    expect(await createEscrow('a@b.com', 0)).toHaveProperty('error')
    expect(await createEscrow('a@b.com', 1000, 'x'.repeat(141))).toHaveProperty('error')
    expect(mockedCreateClient).not.toHaveBeenCalled()
  })

  it('requires MFA', async () => {
    mockedMfa.mockResolvedValue({ ok: false, error: 'Two-factor verification is required' })
    expect(await createEscrow('a@b.com', 1000)).toEqual({ error: 'Two-factor verification is required' })
    expect(mockedCreateClient).not.toHaveBeenCalled()
  })

  it('is rate limited', async () => {
    mockedRateLimit.mockResolvedValue(false)
    expect(await createEscrow('a@b.com', 1000)).toHaveProperty('error')
    expect(mockedCreateClient).not.toHaveBeenCalled()
  })

  it('errors when the recipient does not exist', async () => {
    useRpc(async () => ({ data: null, error: null }))
    expect(await createEscrow('nobody@example.com', 1000)).toEqual({ error: 'No Valoron user found with that email' })
  })

  it('passes recipient, amount and description to fund_escrow', async () => {
    const rpc = vi.fn(async (fn: string, _args?: Record<string, unknown>) =>
      fn === 'find_recipient_account' ? { data: 'acct-2', error: null } : { data: { status: 'completed' }, error: null }
    )
    useRpc(rpc)
    await createEscrow('friend@example.com', 2500, 'logo design')
    const call = rpc.mock.calls.find(([fn]) => fn === 'fund_escrow')!
    expect(call[1]).toMatchObject({ p_recipient_account_id: 'acct-2', p_amount_cents: 2500, p_description: 'logo design' })
    expect(String((call[1] as Record<string, unknown>).p_idempotency_key)).toMatch(/^escrow-fund-/)
  })

  it('surfaces database errors such as insufficient balance', async () => {
    useRpc(async (fn) =>
      fn === 'find_recipient_account'
        ? { data: 'acct-2', error: null }
        : { data: null, error: { message: 'insufficient balance' } }
    )
    expect(await createEscrow('friend@example.com', 2500)).toEqual({ error: 'insufficient balance' })
  })
})

describe('releaseEscrow / refundEscrow', () => {
  it('rejects a malformed escrow id', async () => {
    expect(await releaseEscrow('nope')).toEqual({ error: 'Invalid escrow' })
    expect(mockedCreateClient).not.toHaveBeenCalled()
  })

  it('requires MFA', async () => {
    mockedMfa.mockResolvedValue({ ok: false, error: 'mfa' })
    expect(await refundEscrow(ESCROW_ID)).toEqual({ error: 'mfa' })
  })

  it('calls the matching RPC', async () => {
    const rpc = vi.fn(async (_fn: string, _args?: Record<string, unknown>) => ({ data: { status: 'completed' }, error: null }))
    useRpc(rpc)
    expect(await releaseEscrow(ESCROW_ID)).toEqual({ status: 'completed' })
    expect(await refundEscrow(ESCROW_ID)).toEqual({ status: 'completed' })
    expect(rpc.mock.calls.map(([fn]) => fn)).toEqual(['release_escrow', 'refund_escrow'])
  })

  it('surfaces database errors', async () => {
    useRpc(async () => ({ data: null, error: { message: 'only the funder can release this escrow' } }))
    expect(await releaseEscrow(ESCROW_ID)).toEqual({ error: 'only the funder can release this escrow' })
  })
})
