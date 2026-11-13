import Anthropic from '@anthropic-ai/sdk'

/**
 * Model used by every AI feature. Override with AI_MODEL (e.g. a Sonnet or
 * Haiku model) to trade quality for cost without a code change.
 */
export const AI_MODEL = process.env.AI_MODEL || 'claude-opus-5-5'

let client: Anthropic | null | undefined

/**
 * Returns a client, or null when ANTHROPIC_API_KEY is not configured. AI
 * features check for null and degrade (the insights card falls back to a
 * plain summary; the assistant says it is not set up) instead of crashing
 * the page, so the app keeps working in environments without a key.
 */
export function getAnthropic(): Anthropic | null {
  if (client !== undefined) return client
  client = process.env.ANTHROPIC_API_KEY ? new Anthropic({ maxRetries: 2, timeout: 60_000 }) : null
  return client
}

/**
 * Server-side refusal fallback: if the model declines a request, the API
 * retries it on a suitable fallback model inside the same call.
 */
export function fallbackParams(): { betas: Anthropic.Beta.AnthropicBeta[]; fallbacks: 'default' } {
  return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
}
