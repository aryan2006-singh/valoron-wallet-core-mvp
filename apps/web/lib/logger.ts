import pino from 'pino'

/**
 * Structured logger for every server-side path.
 *
 * The `redact` list is a safety net, not the primary defence: call sites
 * are expected never to pass a secret in the first place. Passwords, TOTP
 * codes, tokens and API keys must never reach a log — they would sit in
 * plaintext in whatever log sink this ships to, which is both a breach
 * waiting to happen and an instant finding in any security review.
 */
export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  base: { service: 'valoron-wallet' },
  redact: {
    paths: [
      'password',
      '*.password',
      'newPassword',
      '*.newPassword',
      'token',
      '*.token',
      'accessToken',
      '*.accessToken',
      'refreshToken',
      '*.refreshToken',
      'secret',
      '*.secret',
      'clientSecret',
      '*.clientSecret',
      'apiKey',
      '*.apiKey',
      'authorization',
      '*.authorization',
      'cookie',
      '*.cookie',
      'code',
      '*.code',
    ],
    censor: '[REDACTED]',
  },
})

/**
 * Emails are useful in an auth log (they are how you trace an incident to
 * an account) but they are also personal data, so anything beyond the
 * first character and the domain is masked: `a****@example.com`.
 */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return '[invalid-email]'
  const head = local.slice(0, 1)
  return `${head}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`
}
