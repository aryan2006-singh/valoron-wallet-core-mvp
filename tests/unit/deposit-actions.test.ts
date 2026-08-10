import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/stripe/client', () => ({ stripe: { paymentIntents: { create: vi.fn() } } }))
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>()
  return { ...actual, enforceRateLimit: vi.fn().mockResolvedValue(true) }
})

import { createClient } from '@/lib/supabase/server'
import { stripe } from '@/lib/stripe/client'
import { createDepositIntent } from '@/app/deposit/actions'

function mockSupabase(userId: string | null, accountId: string | null) {
  return {
    auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: accountId ? { id: accountId } : null }) }) }),
    }),
  }
}

const mockedCreateClient = vi.mocked(createClient)
const mockedCreatePaymentIntent = vi.mocked(stripe.paymentIntents.create)

describe('createDepositIntent', () => {
  it('rejects an amount below the schema minimum', async () => {
    mockedCreateClient.mockResolvedValue(mockSupabase('u1', 'a1') as unknown as Awaited<ReturnType<typeof createClient>>)
    const result = await createDepositIntent(50)
    expect(result).toHaveProperty('error')
  })

  it('creates a PaymentIntent and returns its client secret', async () => {
    mockedCreateClient.mockResolvedValue(mockSupabase('u1', 'a1') as unknown as Awaited<ReturnType<typeof createClient>>)
    mockedCreatePaymentIntent.mockResolvedValue(
      { client_secret: 'pi_secret_123' } as unknown as Awaited<ReturnType<typeof stripe.paymentIntents.create>>
    )

    const result = await createDepositIntent(2000)
    expect(result).toEqual({ clientSecret: 'pi_secret_123' })
    expect(stripe.paymentIntents.create).toHaveBeenCalled()
  })
})
