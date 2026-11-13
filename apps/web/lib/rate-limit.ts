import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import * as Sentry from '@sentry/nextjs'

function createRateLimiter(prefix: string, limit: number, window: `${number} ${'s' | 'm' | 'h'}`) {
  return new Ratelimit({
    // `retry: false` disables the client's default 5-attempt exponential
    // backoff (~4.3s total) on network errors. enforceRateLimit below
    // already fails open on any error, so retrying is pure added latency
    // on every rate-limited request whenever Redis is unreachable — an
    // outage, or (as in local dev) an unconfigured Upstash env var — with
    // no corresponding benefit.
    redis: Redis.fromEnv({ retry: false }),
    limiter: Ratelimit.slidingWindow(limit, window),
    prefix: `ratelimit:${prefix}`,
  })
}

// Baseline abuse resistance for this MVP. Burst/DDoS-scale tuning is
// covered by the dedicated Scaling spec.
export const loginRateLimit = createRateLimiter('login', 5, '1 m')
export const transferRateLimit = createRateLimiter('transfer', 10, '1 m')
export const escrowRateLimit = createRateLimiter('escrow', 10, '1 m')
export const withdrawalRateLimit = createRateLimiter('withdrawal', 5, '1 h')
export const depositRateLimit = createRateLimiter('deposit', 10, '1 h') // card-testing-fraud resistance

export async function enforceRateLimit(limiter: Ratelimit, identifier: string): Promise<boolean> {
  try {
    const result = await limiter.limit(identifier)
    return result.success
  } catch (err) {
    // Fail open: an Upstash outage or network blip must not take the
    // whole app down with it. Still report it — a silent rate-limiter
    // outage is itself a security-relevant blind spot.
    Sentry.captureException(err)
    return true
  }
}
