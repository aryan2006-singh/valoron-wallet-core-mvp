import { describe, it, expect } from 'vitest'
import { enforceRateLimit } from '@/lib/rate-limit'
import type { Ratelimit } from '@upstash/ratelimit'

function fakeLimiter(success: boolean): Ratelimit {
  return {
    limit: async () => ({ success, limit: 5, remaining: success ? 4 : 0, reset: Date.now() }),
  } as unknown as Ratelimit
}

function unreachableLimiter(): Ratelimit {
  return { limit: async () => { throw new Error('fetch failed') } } as unknown as Ratelimit
}

describe('enforceRateLimit', () => {
  it('returns true when the limiter allows the request', async () => {
    expect(await enforceRateLimit(fakeLimiter(true), 'user-1')).toBe(true)
  })
  it('returns false when the limiter denies the request', async () => {
    expect(await enforceRateLimit(fakeLimiter(false), 'user-1')).toBe(false)
  })
  it('fails open (returns true) when the rate limiter itself is unreachable', async () => {
    expect(await enforceRateLimit(unreachableLimiter(), 'user-1')).toBe(true)
  })
})
