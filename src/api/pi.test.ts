import { describe, expect, it, vi } from 'vitest'

import type { BundleSource } from '../storage/bundleFiles'
import { NetworkError, PI_CODES, PiApiError, PiClient, type EventSourceLike } from './pi'

const KIB = 1024

function bytesOf(size: number): Uint8Array {
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) out[i] = (i * 7 + 3) & 0xff
  return out
}

function sourceOf(bytes: Uint8Array, name = 'show-abcdef01.belen.zip'): BundleSource & { reads: Array<[number, number]> } {
  const reads: Array<[number, number]> = []
  return {
    name,
    size: bytes.byteLength,
    reads,
    async slice(start, end) {
      reads.push([start, end])
      return bytes.subarray(start, end)
    },
  }
}

interface Call {
  method: string
  url: string
  headers: Record<string, string>
  body: Uint8Array | null
}

interface FakePiOptions {
  /** Ordered faults for chunk PUTs: index = PUT attempt number (0-based). */
  putFaults?: Record<number, 'network' | 'server' | 'lost-response'>
  existingUploads?: Record<string, { size: number; received: Uint8Array }>
  finishStatus?: 200 | 422
  pin?: string
}

/** In-memory `belen-api` for the upload endpoints. */
function fakePi(options: FakePiOptions = {}) {
  const pin = options.pin ?? '123456'
  const calls: Call[] = []
  const uploads = new Map<string, { name: string; size: number; received: Uint8Array }>()
  for (const [id, u] of Object.entries(options.existingUploads ?? {})) uploads.set(id, { name: 'x', size: u.size, received: u.received })
  let putAttempts = 0
  let nextId = 1
  let multipart: { fileName: string; bytes: Uint8Array; activate: string } | null = null

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } })

  async function bodyBytes(init?: RequestInit): Promise<Uint8Array | null> {
    const b = init?.body
    if (!b) return null
    if (typeof b === 'string') return new TextEncoder().encode(b)
    if (b instanceof Blob) return new Uint8Array(await b.arrayBuffer())
    if (b instanceof FormData) return null
    throw new Error('unexpected body type')
  }

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    const body = await bodyBytes(init)
    calls.push({ method, url, headers, body })
    const path = new URL(url, 'http://pi').pathname
    const query = new URL(url, 'http://pi').searchParams

    const needsPin = () => {
      const auth = headers.authorization ?? ''
      if (!auth.startsWith('Pin ')) return json(401, { error: 'pin_required', message: 'Hace falta el PIN' })
      if (auth.slice(4) !== pin) return json(401, { error: 'pin_invalid', message: 'PIN incorrecto' })
      return null
    }

    if (method === 'GET' && path === '/api/status') return json(200, { state: 'IDLE', hardware: [] })

    if (method === 'POST' && path === '/api/bundles') {
      const denied = needsPin()
      if (denied) return denied
      const form = init?.body as FormData
      const file = form.get('file') as File
      multipart = { fileName: file.name, bytes: new Uint8Array(await file.arrayBuffer()), activate: query.get('activate') ?? '' }
      return json(options.finishStatus ?? 200, { ok: (options.finishStatus ?? 200) === 200, hash: 'sha256:' + 'a'.repeat(64), name: 'Show', errors: [], warnings: [], imported: ['show.json'], skipped: [], activated: query.get('activate') === '1' })
    }

    if (method === 'POST' && path === '/api/uploads') {
      const denied = needsPin()
      if (denied) return denied
      const data = JSON.parse(new TextDecoder().decode(body!)) as { name: string; size: number }
      const id = `up${nextId++}`
      uploads.set(id, { name: data.name, size: data.size, received: new Uint8Array(0) })
      return json(201, { uploadId: id, name: data.name, size: data.size, received: 0 })
    }

    const m = /^\/api\/uploads\/([^/]+)(\/finish)?$/.exec(path)
    if (m) {
      const id = m[1]!
      const upload = uploads.get(id)
      if (method === 'GET') {
        if (!upload) return json(404, { error: 'unknown_upload', message: 'Subida desconocida' })
        return json(200, { uploadId: id, name: upload.name, size: upload.size, received: upload.received.byteLength })
      }
      const denied = needsPin()
      if (denied) return denied
      if (!upload) return json(404, { error: 'unknown_upload', message: 'Subida desconocida' })
      if (method === 'PUT') {
        const attempt = putAttempts++
        const fault = options.putFaults?.[attempt]
        if (fault === 'network') throw new TypeError('Failed to fetch')
        if (fault === 'server') return json(500, { error: 'internal', message: 'boom' })
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headers['content-range'] ?? '')
        if (!range) return json(400, { error: 'bad_range', message: 'Falta Content-Range' })
        const [start, end, total] = [Number(range[1]), Number(range[2]), Number(range[3])]
        if (total !== upload.size || end < start || end >= total) return json(400, { error: 'bad_range', message: 'incoherente' })
        if (start !== upload.received.byteLength) return json(409, { error: 'bad_offset', message: `Se esperaba el byte ${upload.received.byteLength}`, received: upload.received.byteLength })
        const chunk = body!
        if (chunk.byteLength !== end - start + 1) return json(400, { error: 'bad_length', message: 'longitud' })
        const next = new Uint8Array(upload.received.byteLength + chunk.byteLength)
        next.set(upload.received, 0)
        next.set(chunk, upload.received.byteLength)
        upload.received = next
        if (fault === 'lost-response') throw new TypeError('Failed to fetch')
        return json(200, { uploadId: id, name: upload.name, size: upload.size, received: upload.received.byteLength })
      }
      if (method === 'POST' && m[2]) {
        if (upload.received.byteLength !== upload.size) return json(409, { error: 'incomplete', message: 'Faltan bytes', received: upload.received.byteLength })
        uploads.delete(id)
        const status = options.finishStatus ?? 200
        return json(status, {
          ok: status === 200,
          hash: 'sha256:' + 'b'.repeat(64),
          name: 'Show',
          errors: status === 422 ? [{ level: 'error', code: 'E_BUNDLE_SHA256', message: 'hash' }] : [],
          warnings: [],
          imported: status === 200 ? ['show.json'] : [],
          skipped: ['assets/audio/1-a.mp3'],
          activated: status === 200 && query.get('activate') === '1',
        })
      }
    }
    return json(404, { error: 'not_found', message: path })
  }

  return {
    fetchImpl,
    calls,
    uploads,
    get multipart() {
      return multipart
    },
    puts: () => calls.filter((c) => c.method === 'PUT'),
  }
}

function client(fetchImpl: typeof fetch, overrides: Partial<ConstructorParameters<typeof PiClient>[0]> = {}) {
  const sleeps: number[] = []
  const c = new PiClient({
    baseUrl: 'http://pi:8080/',
    pin: '123456',
    name: 'Joan',
    fetchImpl,
    sleep: async (ms) => void sleeps.push(ms),
    chunkSize: 4 * KIB,
    singleShotMax: 2 * KIB,
    eventSourceFactory: null,
    ...overrides,
  })
  return { c, sleeps }
}

describe('PiClient.uploadBundle (chunked)', () => {
  it('creates the upload, sends 1 chunk per chunkSize with Content-Range and finishes with activate', async () => {
    const pi = fakePi()
    const bytes = bytesOf(10 * KIB + 100)
    const source = sourceOf(bytes)
    const { c } = client(pi.fetchImpl)
    const progress: number[] = []
    const ids: Array<string | null> = []

    const result = await c.uploadBundle(source, { activate: true, onProgress: (sent) => progress.push(sent), onUploadId: (id) => ids.push(id) })

    expect(result.status).toBe(200)
    expect(result.report.ok).toBe(true)
    expect(result.report.activated).toBe(true)
    expect(result.report.skipped).toEqual(['assets/audio/1-a.mp3'])
    const create = pi.calls.find((x) => x.method === 'POST' && x.url.endsWith('/api/uploads'))!
    expect(create.headers.authorization).toBe('Pin 123456')
    expect(create.headers['x-name']).toBe('Joan')
    expect(JSON.parse(new TextDecoder().decode(create.body!))).toEqual({ name: source.name, size: bytes.byteLength })
    const puts = pi.puts()
    expect(puts).toHaveLength(3)
    expect(puts.map((p) => p.headers['content-range'])).toEqual([
      `bytes 0-${4 * KIB - 1}/${bytes.byteLength}`,
      `bytes ${4 * KIB}-${8 * KIB - 1}/${bytes.byteLength}`,
      `bytes ${8 * KIB}-${bytes.byteLength - 1}/${bytes.byteLength}`,
    ])
    expect(puts.every((p) => p.headers['content-type'] === 'application/octet-stream')).toBe(true)
    expect(pi.calls.at(-1)!.url).toBe(`http://pi:8080/api/uploads/up1/finish?activate=1`)
    expect(progress).toEqual([0, 4 * KIB, 8 * KIB, bytes.byteLength])
    expect(ids).toEqual(['up1', null])
    expect(source.reads).toEqual([[0, 4 * KIB], [4 * KIB, 8 * KIB], [8 * KIB, bytes.byteLength]])
  })

  it('resumes from the stored uploadId at the offset the Pi reports', async () => {
    const bytes = bytesOf(9 * KIB)
    const pi = fakePi({ existingUploads: { up7: { size: bytes.byteLength, received: bytes.subarray(0, 4 * KIB) } } })
    const { c } = client(pi.fetchImpl)
    const progress: number[] = []

    const result = await c.uploadBundle(sourceOf(bytes), { resumeUploadId: 'up7', onProgress: (sent) => progress.push(sent) })

    expect(result.status).toBe(200)
    expect(pi.calls[0]).toMatchObject({ method: 'GET', url: 'http://pi:8080/api/uploads/up7' })
    expect(pi.calls.some((x) => x.method === 'POST' && x.url.endsWith('/api/uploads'))).toBe(false)
    expect(pi.puts().map((p) => p.headers['content-range'])).toEqual([`bytes ${4 * KIB}-${8 * KIB - 1}/${bytes.byteLength}`, `bytes ${8 * KIB}-${9 * KIB - 1}/${bytes.byteLength}`])
    expect(progress[0]).toBe(4 * KIB)
  })

  it('starts a new upload when the stored uploadId is unknown or has another size', async () => {
    const bytes = bytesOf(5 * KIB)
    const pi = fakePi({ existingUploads: { stale: { size: 999, received: new Uint8Array(0) } } })
    const { c } = client(pi.fetchImpl)

    await c.uploadBundle(sourceOf(bytes), { resumeUploadId: 'stale' })
    expect(pi.calls.filter((x) => x.method === 'POST' && x.url.endsWith('/api/uploads'))).toHaveLength(1)

    pi.calls.length = 0
    await c.uploadBundle(sourceOf(bytes), { resumeUploadId: 'does-not-exist' })
    expect(pi.calls[0]!.url).toBe('http://pi:8080/api/uploads/does-not-exist')
    expect(pi.calls.filter((x) => x.method === 'POST' && x.url.endsWith('/api/uploads'))).toHaveLength(1)
  })

  it('re-syncs on 409 bad_offset when the Pi wrote a chunk whose response was lost', async () => {
    const bytes = bytesOf(12 * KIB)
    const pi = fakePi({ putFaults: { 1: 'lost-response' } })
    const { c, sleeps } = client(pi.fetchImpl)

    const result = await c.uploadBundle(sourceOf(bytes))

    expect(result.status).toBe(200)
    const ranges = pi.puts().map((p) => p.headers['content-range'])
    // chunk 2 written but answer lost → retried with the same offset → 409 → jumps to 8 KiB
    expect(ranges).toEqual([
      `bytes 0-${4 * KIB - 1}/${bytes.byteLength}`,
      `bytes ${4 * KIB}-${8 * KIB - 1}/${bytes.byteLength}`,
      `bytes ${4 * KIB}-${8 * KIB - 1}/${bytes.byteLength}`,
      `bytes ${8 * KIB}-${12 * KIB - 1}/${bytes.byteLength}`,
    ])
    expect(sleeps).toEqual([500])
    expect(pi.uploads.size).toBe(0)
  })

  it('retries transport errors and 5xx with exponential backoff', async () => {
    const bytes = bytesOf(6 * KIB)
    const pi = fakePi({ putFaults: { 0: 'network', 1: 'server', 2: 'network' } })
    const { c, sleeps } = client(pi.fetchImpl)

    const result = await c.uploadBundle(sourceOf(bytes))

    expect(result.status).toBe(200)
    expect(sleeps).toEqual([500, 1000, 2000])
    expect(pi.puts()).toHaveLength(5)
  })

  it('gives up after maxAttempts transport errors', async () => {
    const pi = fakePi({ putFaults: { 0: 'network', 1: 'network', 2: 'network', 3: 'network' } })
    const { c, sleeps } = client(pi.fetchImpl)

    await expect(c.uploadBundle(sourceOf(bytesOf(6 * KIB)))).rejects.toBeInstanceOf(NetworkError)
    expect(sleeps).toEqual([500, 1000, 2000])
  })

  it('does not retry a wrong PIN and reports it as needsPin', async () => {
    const pi = fakePi({ pin: '999999' })
    const { c, sleeps } = client(pi.fetchImpl)

    const err = await c.uploadBundle(sourceOf(bytesOf(6 * KIB))).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(PiApiError)
    expect((err as PiApiError).code).toBe(PI_CODES.pinInvalid)
    expect((err as PiApiError).needsPin).toBe(true)
    expect(sleeps).toEqual([])
  })

  it('fails locally with pin_required when no PIN is configured, without touching the network', async () => {
    const pi = fakePi()
    const { c } = client(pi.fetchImpl, { pin: null })

    const err = await c.uploadBundle(sourceOf(bytesOf(6 * KIB))).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(PiApiError)
    expect((err as PiApiError).code).toBe(PI_CODES.pinRequired)
    expect(pi.calls).toHaveLength(0)
  })

  it('returns the 422 report when the Pi rejects the bundle at finish', async () => {
    const pi = fakePi({ finishStatus: 422 })
    const { c } = client(pi.fetchImpl)

    const result = await c.uploadBundle(sourceOf(bytesOf(5 * KIB)))

    expect(result.status).toBe(422)
    expect(result.report.ok).toBe(false)
    expect(result.report.errors).toEqual([{ level: 'error', code: 'E_BUNDLE_SHA256', message: 'hash' }])
  })

  it('reports the aborted signal as a NetworkError and keeps the uploadId for a later resume', async () => {
    const pi = fakePi()
    const { c } = client(pi.fetchImpl)
    const controller = new AbortController()
    const ids: Array<string | null> = []
    const source = sourceOf(bytesOf(12 * KIB))
    source.slice = async (start, end) => {
      if (start >= 4 * KIB) controller.abort()
      return bytesOf(12 * KIB).subarray(start, end)
    }

    const err = await c.uploadBundle(source, { signal: controller.signal, onUploadId: (id) => ids.push(id) }).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(NetworkError)
    expect((err as NetworkError).aborted).toBe(true)
    expect(ids).toEqual(['up1'])
  })
})

describe('PiClient.uploadBundle (single shot)', () => {
  it('posts small files as multipart field "file" with the activate flag', async () => {
    const pi = fakePi()
    const bytes = bytesOf(KIB)
    const { c } = client(pi.fetchImpl)
    const progress: number[] = []

    const result = await c.uploadBundle(sourceOf(bytes, 'petit-01234567.belen.zip'), { activate: false, onProgress: (s) => progress.push(s) })

    expect(result.status).toBe(200)
    expect(pi.calls).toHaveLength(1)
    expect(pi.calls[0]!.url).toBe('http://pi:8080/api/bundles?activate=0')
    expect(pi.multipart?.fileName).toBe('petit-01234567.belen.zip')
    expect(pi.multipart?.bytes).toEqual(bytes)
    expect(progress).toEqual([0, KIB])
  })
})

describe('PiClient reads and writes', () => {
  it('sends the PIN header only on writes and maps error bodies', async () => {
    const pi = fakePi()
    const { c } = client(pi.fetchImpl)

    await c.status()
    expect(pi.calls[0]!.headers.authorization).toBeUndefined()

    const err = await c.deleteBundle('sha256:' + 'c'.repeat(64)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(PiApiError)
    expect((err as PiApiError).status).toBe(404)
    expect(pi.calls[1]!.headers.authorization).toBe('Pin 123456')
  })
})

describe('PiClient.subscribeStatus', () => {
  it('delivers SSE frames and falls back to polling when the stream fails', async () => {
    vi.useFakeTimers()
    try {
      const pi = fakePi()
      let es: EventSourceLike & { url: string } | null = null
      const { c } = client(pi.fetchImpl, {
        eventSourceFactory: (url) => {
          es = { url, onmessage: null, onerror: null, close: vi.fn() }
          return es
        },
      })
      const seen: string[] = []
      const stop = c.subscribeStatus((s) => seen.push(s.state), { pollMs: 1000 })

      expect(es!.url).toBe('http://pi:8080/api/events')
      es!.onmessage!({ data: JSON.stringify({ state: 'PLAYING', hardware: [] }) })
      expect(seen).toEqual(['PLAYING'])

      es!.onerror!(new Event('error'))
      expect(es!.close).toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(0)
      expect(seen).toEqual(['PLAYING', 'IDLE'])
      await vi.advanceTimersByTimeAsync(1000)
      expect(seen).toEqual(['PLAYING', 'IDLE', 'IDLE'])

      stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(seen).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('polls directly when SSE is disabled', async () => {
    vi.useFakeTimers()
    try {
      const pi = fakePi()
      const factory = vi.fn()
      const { c } = client(pi.fetchImpl, { eventSourceFactory: factory })
      const seen: string[] = []
      const stop = c.subscribeStatus((s) => seen.push(s.state), { sse: false, pollMs: 500 })
      await vi.advanceTimersByTimeAsync(0)
      expect(factory).not.toHaveBeenCalled()
      expect(seen).toEqual(['IDLE'])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })
})

/** Minimal `belen-api` for alerts and motors: records every call and answers from `routes`. */
function fakeAlertsPi(routes: Record<string, (headers: Record<string, string>) => Response>) {
  const calls: Array<{ method: string; path: string; headers: Record<string, string> }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = new URL(String(input), 'http://pi').pathname
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    calls.push({ method, path, headers })
    const route = routes[`${method} ${path}`]
    return route ? route(headers) : new Response(JSON.stringify({ error: 'not_found', message: path }), { status: 404 })
  }
  return { fetchImpl, calls }
}

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const TIMEOUT_ALERT = { code: 'motor_timeout', port: 'angel', message: "El motor «angel» ha superat el temps màxim.", at: '2026-10-21T14:00:00+00:00', direction: 'forward', locked: true }
const LOCKED_MOTOR = { direction: null, runningS: 0, lastEnd: 'max_time', locked: true, blocked: false, limitForward: 'fc-dalt', limitReverse: null }

describe('PiClient alerts and motors', () => {
  it('reads the alerts with their extra fields', async () => {
    const pi = fakeAlertsPi({ 'GET /api/alerts': () => jsonResponse(200, { alerts: [TIMEOUT_ALERT] }) })
    const { c } = client(pi.fetchImpl)

    const alerts = await c.getAlerts()

    expect(alerts).toEqual([TIMEOUT_ALERT])
    expect(alerts[0]!.direction).toBe('forward')
    expect(pi.calls[0]!.headers.authorization).toBeUndefined()
  })

  it.each([
    ['an empty list', { alerts: [] }],
    ['a missing field', {}],
    ['a non-array field', { alerts: 'nope' }],
    ['an empty body', null],
  ])('returns no alerts for %s', async (_label, body) => {
    const pi = fakeAlertsPi({ 'GET /api/alerts': () => (body === null ? new Response('', { status: 200 }) : jsonResponse(200, body)) })
    const { c } = client(pi.fetchImpl)

    expect(await c.getAlerts()).toEqual([])
  })

  it('drops entries that are not objects and keeps unknown codes', async () => {
    const unknown = { code: 'future_code', port: null, message: 'x', at: '2026-10-21T14:00:00+00:00' }
    const pi = fakeAlertsPi({ 'GET /api/alerts': () => jsonResponse(200, { alerts: [null, 3, 'a', unknown] }) })
    const { c } = client(pi.fetchImpl)

    expect(await c.getAlerts()).toEqual([unknown])
  })

  it('clears the alerts with DELETE and the PIN header', async () => {
    const pi = fakeAlertsPi({ 'DELETE /api/alerts': () => jsonResponse(200, { cleared: 2, alerts: [] }) })
    const { c } = client(pi.fetchImpl)

    const result = await c.clearAlerts()

    expect(result).toEqual({ cleared: 2, alerts: [] })
    expect(pi.calls[0]!.headers.authorization).toBe('Pin 123456')
    expect(pi.calls[0]!.headers['x-name']).toBe('Joan')
  })

  it('refuses to clear alerts without a PIN and never touches the network', async () => {
    const pi = fakeAlertsPi({})
    const { c } = client(pi.fetchImpl, { pin: null })

    const err = await c.clearAlerts().catch((e: unknown) => e)

    expect(err).toBeInstanceOf(PiApiError)
    expect((err as PiApiError).code).toBe(PI_CODES.pinRequired)
    expect((err as PiApiError).needsPin).toBe(true)
    expect(pi.calls).toHaveLength(0)
  })

  it('maps a wrong PIN on clear to pin_invalid', async () => {
    const pi = fakeAlertsPi({ 'DELETE /api/alerts': () => jsonResponse(401, { error: 'pin_invalid', message: 'PIN incorrecto' }) })
    const { c } = client(pi.fetchImpl)

    const err = (await c.clearAlerts().catch((e: unknown) => e)) as PiApiError

    expect(err.status).toBe(401)
    expect(err.code).toBe(PI_CODES.pinInvalid)
    expect(err.needsPin).toBe(true)
  })

  it('unlocks a motor, encoding its name, and returns the motors', async () => {
    const motors = { 'àngel 1': { ...LOCKED_MOTOR, locked: false } }
    const pi = fakeAlertsPi({ 'POST /api/motors/%C3%A0ngel%201/unlock': () => jsonResponse(200, { motor: 'àngel 1', unlocked: true, motors }) })
    const { c } = client(pi.fetchImpl)

    const result = await c.unlockMotor('àngel 1')

    expect(result).toEqual({ motor: 'àngel 1', unlocked: true, motors })
    expect(pi.calls[0]!.method).toBe('POST')
    expect(pi.calls[0]!.headers.authorization).toBe('Pin 123456')
  })

  it('passes through unlocked=false when the motor was not locked', async () => {
    const pi = fakeAlertsPi({ 'POST /api/motors/angel/unlock': () => jsonResponse(200, { motor: 'angel', unlocked: false, motors: { angel: { ...LOCKED_MOTOR, locked: false } } }) })
    const { c } = client(pi.fetchImpl)

    const result = await c.unlockMotor('angel')

    expect(result.unlocked).toBe(false)
    expect(result.motors.angel!.locked).toBe(false)
  })

  it('fails with unknown_target for a port that is not a motor', async () => {
    const pi = fakeAlertsPi({ 'POST /api/motors/llum/unlock': () => jsonResponse(404, { error: 'unknown_target', message: 'Motor desconocido: llum' }) })
    const { c } = client(pi.fetchImpl)

    const err = (await c.unlockMotor('llum').catch((e: unknown) => e)) as PiApiError

    expect(err).toBeInstanceOf(PiApiError)
    expect(err.code).toBe(PI_CODES.unknownTarget)
    expect(err.needsPin).toBe(false)
  })

  it('refuses to unlock without a PIN and never touches the network', async () => {
    const pi = fakeAlertsPi({})
    const { c } = client(pi.fetchImpl, { pin: null })

    const err = (await c.unlockMotor('angel').catch((e: unknown) => e)) as PiApiError

    expect(err.code).toBe(PI_CODES.pinRequired)
    expect(pi.calls).toHaveLength(0)
  })

  it('keeps sensors, motors and alerts of the status', async () => {
    const sensors = { porta: { active: true, raw: false, onActive: 'stop_show', blocked: false, address: 'exp1:15' } }
    const pi = fakeAlertsPi({ 'GET /api/status': () => jsonResponse(200, { state: 'IDLE', hardware: [], sensors, motors: { angel: LOCKED_MOTOR }, alerts: [TIMEOUT_ALERT] }) })
    const { c } = client(pi.fetchImpl)

    const status = await c.status()

    expect(status.sensors).toEqual(sensors)
    expect(status.motors?.angel?.locked).toBe(true)
    expect(status.alerts).toEqual([TIMEOUT_ALERT])
  })
})
