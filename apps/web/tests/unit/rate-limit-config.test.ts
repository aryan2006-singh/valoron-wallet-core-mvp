import { describe, it, expect, beforeEach, vi } from 'vitest'

// `enforceRateLimit` (tests/unit/rate-limit.test.ts) already covers the
// fail-open behavior with hand-built fake limiters, but nothing exercised
// how the real Redis client passed to Ratelimit is actually configured —
// so a revert of the `retry: false` fix, or an @upstash/redis upgrade
// that changes its default, would go uncaught. This mocks Redis.fromEnv
// to inspect exactly what config lib/rate-limit.ts constructs it with.
const fromEnvMock = vi.fn<(config?: { retry: boolean }) => object>(() => ({}))

vi.mock('@upstash/redis', () => ({
  Redis: { fromEnv: fromEnvMock },
}))

// lib/rate-limit.ts also imports @sentry/nextjs. Left un-mocked, the
// dynamic import below (required so vi.resetModules() picks up the mock
// above) cold-loads the real Sentry SDK on every run of this test and can
// blow past the default test timeout — overhead unrelated to what this
// test actually checks.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}))

describe('rate limiter Redis client configuration', () => {
  beforeEach(() => {
    fromEnvMock.mockClear()
    vi.resetModules()
  })

  it('disables the Upstash client default retry/backoff so a failure is detected on the first attempt', async () => {
    // lib/rate-limit.ts constructs one Redis client per exported limiter
    // (login/transfer/withdrawal/deposit) at module load time.
    await import('@/lib/rate-limit')

    expect(fromEnvMock).toHaveBeenCalled()
    for (const call of fromEnvMock.mock.calls) {
      expect(call[0]).toEqual({ retry: false })
    }
  })
})
