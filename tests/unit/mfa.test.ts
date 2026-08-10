import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

import { createClient } from '@/lib/supabase/server'
import { requireVerifiedMfa } from '@/lib/auth/mfa'

function mockSupabase(user: { id: string } | null, aal: 'aal1' | 'aal2' | null) {
  return {
    auth: {
      getUser: async () => ({ data: { user } }),
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({
          data: aal ? { currentLevel: aal } : null,
          error: aal ? null : new Error('no session'),
        }),
      },
    },
  }
}

const mockedCreateClient = vi.mocked(createClient)

describe('requireVerifiedMfa', () => {
  it('rejects when there is no authenticated user', async () => {
    mockedCreateClient.mockResolvedValue(mockSupabase(null, null) as unknown as Awaited<ReturnType<typeof createClient>>)
    expect((await requireVerifiedMfa()).ok).toBe(false)
  })

  it('rejects when the session is only aal1', async () => {
    mockedCreateClient.mockResolvedValue(mockSupabase({ id: 'u1' }, 'aal1') as unknown as Awaited<ReturnType<typeof createClient>>)
    expect((await requireVerifiedMfa()).ok).toBe(false)
  })

  it('accepts when the session is aal2', async () => {
    mockedCreateClient.mockResolvedValue(mockSupabase({ id: 'u1' }, 'aal2') as unknown as Awaited<ReturnType<typeof createClient>>)
    expect(await requireVerifiedMfa()).toEqual({ ok: true, userId: 'u1' })
  })
})
