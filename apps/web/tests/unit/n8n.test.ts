import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { emitN8nEvent, signN8nBody } from '@/lib/n8n'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('emitN8nEvent', () => {
  it('does nothing when n8n is not configured', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('N8N_WEBHOOK_URL', '')
    expect(await emitN8nEvent('transfer.completed', { amountCents: 1 })).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts a signed event body', async () => {
    vi.stubEnv('N8N_WEBHOOK_URL', 'https://n8n.example.com/webhook/valoron-events')
    vi.stubEnv('N8N_WEBHOOK_SECRET', 'shh')
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('ok'))
    vi.stubGlobal('fetch', fetchMock)

    expect(await emitN8nEvent('transfer.completed', { amountCents: 50000 })).toBe(true)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://n8n.example.com/webhook/valoron-events')
    const body = init.body as string
    expect(JSON.parse(body)).toMatchObject({ type: 'transfer.completed', data: { amountCents: 50000 } })
    const expected = createHmac('sha256', 'shh').update(body).digest('hex')
    expect((init.headers as Record<string, string>)['x-valoron-signature']).toBe(expected)
    expect(signN8nBody(body, 'shh')).toBe(expected)
  })

  it('never throws when n8n is unreachable', async () => {
    vi.stubEnv('N8N_WEBHOOK_URL', 'https://n8n.example.com/webhook/x')
    vi.stubEnv('N8N_WEBHOOK_SECRET', 'shh')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    expect(await emitN8nEvent('transfer.completed', {})).toBe(false)
  })
})
