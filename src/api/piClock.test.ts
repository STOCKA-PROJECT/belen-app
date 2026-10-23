import { describe, expect, it } from 'vitest'

import { PiApiError, PiClient } from './pi'

interface Call { method: string; url: string; headers: Record<string, string>; body: string | undefined }

function client(answer: Response, pin: string | null = null) {
  const calls: Call[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ method: (init?.method ?? 'GET').toUpperCase(), url: String(input), headers: (init?.headers as Record<string, string>) ?? {}, body: init?.body as string | undefined })
    return answer
  }
  return { c: new PiClient({ baseUrl: 'http://belen.local:8080', fetchImpl, pin }), calls }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('PiClient.syncClock', () => {
  it('posts the phone time without PIN while none is known', async () => {
    const { c, calls } = client(json(200, { reliable: true, source: 'client', now: '2026-10-23T18:30:00', adjusted: true, offsetMs: 4000 }))
    const result = await c.syncClock(1_800_000_000_000)
    expect(result.adjusted).toBe(true)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe('http://belen.local:8080/api/clock')
    expect(JSON.parse(calls[0]!.body!)).toEqual({ epochMs: 1_800_000_000_000 })
    expect(calls[0]!.headers.Authorization).toBeUndefined()
  })

  it('sends the PIN when it has one', async () => {
    const { c, calls } = client(json(200, { reliable: true, source: 'client', now: 'x', adjusted: false, offsetMs: 0 }), '123456')
    await c.syncClock()
    expect(calls[0]!.headers.Authorization).toBe('Pin 123456')
  })

  it('surfaces a refusal as PiApiError', async () => {
    const { c } = client(json(401, { error: 'pin_required', message: 'Hace falta el PIN' }))
    await expect(c.syncClock()).rejects.toBeInstanceOf(PiApiError)
  })
})
