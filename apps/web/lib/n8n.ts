import { createHmac } from 'crypto'
import { logger } from '@/lib/logger'

const n8nLog = logger.child({ area: 'n8n' })

export type N8nEventType = 'transfer.completed'

/**
 * HMAC-SHA256 of the raw JSON body, hex-encoded, keyed with
 * N8N_WEBHOOK_SECRET. The n8n workflows in /n8n verify this header so a
 * stranger who finds the webhook URL can't inject fake events.
 */
export function signN8nBody(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex')
}

/**
 * Sends an event to the n8n webhook configured in N8N_WEBHOOK_URL.
 * A no-op when the URL isn't set. Never throws and gives up after 3s: an
 * automation outage must not affect the money movement that triggered it.
 */
export async function emitN8nEvent(type: N8nEventType, data: Record<string, unknown>): Promise<boolean> {
  const url = process.env.N8N_WEBHOOK_URL
  const secret = process.env.N8N_WEBHOOK_SECRET
  if (!url || !secret) return false

  const body = JSON.stringify({ type, occurredAt: new Date().toISOString(), data })
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-valoron-signature': signN8nBody(body, secret) },
      body,
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) n8nLog.warn({ type, status: res.status }, 'n8n webhook rejected event')
    return res.ok
  } catch (err) {
    n8nLog.warn({ type, err: err instanceof Error ? err.message : String(err) }, 'n8n webhook unreachable')
    return false
  }
}
