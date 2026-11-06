import { describe, expect, it } from 'vitest'

import type { ByteSink } from '../storage/bundleFiles'
import { NetworkError, STOCKA_CODES, StockaApiError, StockaClient } from './stocka'

function problem(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: 'x', status, instance: '/x', timestamp: 't', ...body }), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  })
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function recording(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    calls.push({ url, init })
    return responder(url, init)
  }
  return { calls, fetchImpl }
}

function memorySink(): ByteSink & { chunks: Uint8Array[]; closed: boolean; aborted: boolean } {
  const sink = {
    chunks: [] as Uint8Array[],
    closed: false,
    aborted: false,
    async write(chunk: Uint8Array) {
      sink.chunks.push(chunk.slice())
    },
    async close() {
      sink.closed = true
    },
    async abort() {
      sink.aborted = true
    },
  }
  return sink
}

describe('StockaClient error mapping', () => {
  it('maps a 422 timeline_shows.invalid problem to issues and warnings', async () => {
    const { fetchImpl } = recording(() =>
      problem(422, {
        detail: 'El show té errors',
        code: 'timeline_shows.invalid',
        params: {
          errors: 2,
          issues: [
            { level: 'error', code: 'E_NO_PORT', message: 'La peça «Estel» no té port', clipId: 'c1', port: null },
            { level: 'error', code: 'E_LED_LENGTH', message: 'Massa LEDs', port: 'tira' },
          ],
          warnings: [{ level: 'warning', code: 'W_PORT_UNUSED', message: 'Port sense ús' }],
        },
      }),
    )
    const client = new StockaClient({ baseUrl: 'https://stocka.test/', fetchImpl, getToken: () => 'tok' })

    const err = await client.getShowMeta('org', 12).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(StockaApiError)
    const e = err as StockaApiError
    expect(e.status).toBe(422)
    expect(e.code).toBe(STOCKA_CODES.showInvalid)
    expect(e.detail).toBe('El show té errors')
    expect(e.issues).toEqual([
      { level: 'error', code: 'E_NO_PORT', message: 'La peça «Estel» no té port', clipId: 'c1', port: null },
      { level: 'error', code: 'E_LED_LENGTH', message: 'Massa LEDs', clipId: null, port: 'tira' },
    ])
    expect(e.warnings).toEqual([{ level: 'warning', code: 'W_PORT_UNUSED', message: 'Port sense ús', clipId: null, port: null }])
    expect(e.isAuthError).toBe(false)
  })

  it('flags 401 token_expired as an auth error but not invalid credentials', async () => {
    const { fetchImpl } = recording((url) =>
      url.endsWith('/organizations') ? problem(401, { code: 'auth.token_expired', detail: 'La sessió ha caducat.' }) : problem(401, { code: 'auth.invalid_credentials', detail: 'Correu o contrasenya incorrectes.' }),
    )
    const client = new StockaClient({ baseUrl: 'https://stocka.test', fetchImpl, getToken: () => 'tok' })

    const e1 = (await client.listOrganizations().catch((e: unknown) => e)) as StockaApiError
    expect(e1.isAuthError).toBe(true)
    expect(e1.code).toBe(STOCKA_CODES.tokenExpired)

    const e2 = (await client.login('a@b.c', 'bad').catch((e: unknown) => e)) as StockaApiError
    expect(e2.isAuthError).toBe(false)
    expect(e2.code).toBe(STOCKA_CODES.invalidCredentials)
  })

  it('falls back to http.<status> and statusText when the body is not a problem document', async () => {
    const { fetchImpl } = recording(() => new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway', headers: { 'Content-Type': 'text/html' } }))
    const client = new StockaClient({ baseUrl: 'https://stocka.test', fetchImpl })

    const e = (await client.listOrganizations().catch((e: unknown) => e)) as StockaApiError
    expect(e.status).toBe(502)
    expect(e.code).toBe('http.502')
    expect(e.detail).toBe('Bad Gateway')
  })

  it('turns a transport failure into NetworkError', async () => {
    const client = new StockaClient({
      baseUrl: 'https://stocka.test',
      fetchImpl: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await expect(client.listOrganizations()).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('StockaClient auth', () => {
  it('returns a 2FA challenge when the backend asks for it, and a session otherwise', async () => {
    const { calls, fetchImpl } = recording((url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      if (url.endsWith('/auth/login')) return json(200, body.email === '2fa@x.y' ? { requires2fa: true, mfaToken: 'mfa.jwt' } : { accessToken: 'jwt', expiresIn: 900000, user: { id: 1, email: body.email } })
      if (url.endsWith('/auth/login/2fa')) return json(200, { accessToken: 'jwt2', expiresIn: 900000, user: { id: 2, email: '2fa@x.y' } })
      return json(404, {})
    })
    const client = new StockaClient({ baseUrl: 'https://stocka.test', fetchImpl })

    const plain = await client.login('a@b.c', 'pw')
    expect(plain).toEqual({ kind: 'session', session: { accessToken: 'jwt', expiresIn: 900000, user: { id: 1, email: 'a@b.c', username: undefined, name: undefined, lastName: undefined } } })
    expect(calls[0]!.init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBeUndefined()

    const challenge = await client.login('2fa@x.y', 'pw')
    expect(challenge).toEqual({ kind: 'challenge', mfaToken: 'mfa.jwt' })

    const session = await client.loginTwoFactor('mfa.jwt', '123456')
    expect(session.accessToken).toBe('jwt2')
    expect(JSON.parse(String(calls[2]!.init?.body))).toEqual({ mfaToken: 'mfa.jwt', code: '123456', rememberMe: false })
  })

  it('sends the bearer token and Accept-Language on authenticated calls', async () => {
    const { calls, fetchImpl } = recording(() => json(200, [{ id: 3, name: 'Parròquia', slug: 'parroquia', currentUserRole: 'MANAGER', portsEnabled: true }]))
    const client = new StockaClient({ baseUrl: 'https://stocka.test', fetchImpl, getToken: () => 'jwt', getLocale: () => 'es' })

    const orgs = await client.listOrganizations()

    expect(orgs).toEqual([{ id: 3, name: 'Parròquia', slug: 'parroquia', currentUserRole: 'MANAGER' }])
    expect(calls[0]!.url).toBe('https://stocka.test/organizations')
    expect(calls[0]!.init?.headers).toMatchObject({ Authorization: 'Bearer jwt', 'Accept-Language': 'es' })
  })
})

describe('StockaClient.downloadBundle', () => {
  it('streams the body into the sink with progress and reads the file name header', async () => {
    const parts = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array([6])]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const p of parts) controller.enqueue(p)
        controller.close()
      },
    })
    const { calls, fetchImpl } = recording(
      () =>
        new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'application/zip', 'Content-Length': '6', 'Content-Disposition': 'attachment; filename="pessebre-2026-6e46887d.belen.zip"' },
        }),
    )
    const client = new StockaClient({ baseUrl: 'https://stocka.test', fetchImpl, getToken: () => 'jwt' })
    const sink = memorySink()
    const progress: Array<[number, number | null]> = []

    const result = await client.downloadBundle('parroquia', 12, sink, { onProgress: (r, t) => progress.push([r, t]) })

    expect(result).toEqual({ bytes: 6, fileName: 'pessebre-2026-6e46887d.belen.zip' })
    expect(sink.chunks).toEqual(parts)
    expect(progress).toEqual([[3, 6], [5, 6], [6, 6]])
    expect(calls[0]!.url).toBe('https://stocka.test/organizations/parroquia/timelines/12/bundle')
    expect((calls[0]!.init?.headers as Record<string, string>).Accept).toContain('application/zip')
  })

  it('raises the 422 of the bundle endpoint without writing anything', async () => {
    const { fetchImpl } = recording(() => problem(422, { code: 'timeline_shows.invalid', detail: 'x', params: { issues: [{ level: 'error', code: 'E_NO_PORT', message: 'm' }] } }))
    const client = new StockaClient({ baseUrl: 'https://stocka.test', fetchImpl })
    const sink = memorySink()

    const e = (await client.downloadBundle('o', 1, sink).catch((e: unknown) => e)) as StockaApiError
    expect(e.issues).toHaveLength(1)
    expect(sink.chunks).toHaveLength(0)
  })
})

describe('StockaClient player log', () => {
  const UUID = '6f1c2a9e-4b7d-4e21-9c3a-0d5e8f7b1a42'
  const client = (fetchImpl: typeof fetch) => new StockaClient({ baseUrl: 'https://stocka.test/', getToken: () => 'jwt', fetchImpl })

  it('reads the cursor of a player by its uuid with the session', async () => {
    const { calls, fetchImpl } = recording(() => json(200, { files: { 'system-2026-10-26.log': 120, bad: 'x' }, since: '2026-04-29' }))

    const cursor = await client(fetchImpl).logCursor(UUID)

    expect(cursor).toEqual({ files: { 'system-2026-10-26.log': 120 }, since: '2026-04-29' })
    expect(calls[0]!.url).toBe(`https://stocka.test/devices/${UUID}/logs/cursor`)
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt')
  })

  it('tolerates a cursor without files or since', async () => {
    const { fetchImpl } = recording(() => json(200, {}))

    expect(await client(fetchImpl).logCursor(UUID)).toEqual({ files: {}, since: null })
  })

  it('maps an unknown player to 404 devices.not_found', async () => {
    const { fetchImpl } = recording(() => problem(404, { code: 'devices.not_found', detail: 'Dispositiu no trobat.' }))

    const err = (await client(fetchImpl).logCursor(UUID).catch((e: unknown) => e)) as StockaApiError

    expect(err).toBeInstanceOf(StockaApiError)
    expect([err.status, err.code]).toEqual([404, 'devices.not_found'])
  })

  it('uploads the raw bytes of a piece with the file and offset in the query', async () => {
    const { calls, fetchImpl } = recording(() => json(200, { file: 'system-2026-10-26.log', end: 130, stored: 10 }))
    const bytes = new TextEncoder().encode('línia nova\n')

    const result = await client(fetchImpl).uploadLog(UUID, 'system-2026-10-26.log', 120, bytes)

    expect(result).toEqual({ file: 'system-2026-10-26.log', end: 130, stored: 10 })
    expect(calls[0]!.url).toBe(`https://stocka.test/devices/${UUID}/logs?file=system-2026-10-26.log&from=120`)
    expect(calls[0]!.init?.method).toBe('POST')
    expect((calls[0]!.init?.headers as Record<string, string>)['Content-Type']).toBe('text/plain; charset=utf-8')
    const sent = new Uint8Array(await (calls[0]!.init?.body as Blob).arrayBuffer())
    expect(sent).toEqual(bytes)
  })

  it('keeps the expected offset of a 409 in the error params', async () => {
    const { fetchImpl } = recording(() => problem(409, { code: 'devices.log_offset_mismatch', params: { expected: 80 } }))

    const err = (await client(fetchImpl).uploadLog(UUID, 'a.log', 120, new Uint8Array(3)).catch((e: unknown) => e)) as StockaApiError

    expect(err.status).toBe(409)
    expect(err.params.expected).toBe(80)
  })

  it('reports an unreachable backend as a NetworkError', async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new TypeError('Failed to fetch')
    }

    await expect(client(fetchImpl).logCursor(UUID)).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('StockaClient ports and head profiles', () => {
  const client = (fetchImpl: typeof fetch) => new StockaClient({ baseUrl: 'https://stocka.test', getToken: () => 'jwt', fetchImpl })

  it('lists the ports with their config and tolerates junk', async () => {
    const { calls, fetchImpl } = recording(() => json(200, [
      { id: 7, name: 'Cap1', kind: 'moving_head', config: { profile: 'varytec-hero-wash-712z', address: 1, positions: [{ name: 'Portal', pan: 1 }] } },
      { id: 8, name: 'Focos', kind: 'relay' },
      'nope',
    ]))
    const ports = await client(fetchImpl).listPorts('parròquia')
    expect(ports).toEqual([
      { id: 7, name: 'Cap1', kind: 'moving_head', config: { profile: 'varytec-hero-wash-712z', address: 1, positions: [{ name: 'Portal', pan: 1 }] } },
      { id: 8, name: 'Focos', kind: 'relay', config: {} },
    ])
    expect(calls[0]!.url).toBe('https://stocka.test/organizations/parr%C3%B2quia/ports')
    expect(await client(recording(() => json(200, {})).fetchImpl).listPorts('x')).toEqual([])
  })

  it('patches the config of a port and returns the updated port', async () => {
    const { calls, fetchImpl } = recording(() => json(200, { id: 7, name: 'Cap1', kind: 'moving_head', config: { address: 1, positions: [] } }))
    const port = await client(fetchImpl).updatePortConfig('org', 7, { address: 1, positions: [] })
    expect(port).toEqual({ id: 7, name: 'Cap1', kind: 'moving_head', config: { address: 1, positions: [] } })
    expect(calls[0]!.url).toBe('https://stocka.test/organizations/org/ports/7')
    expect(calls[0]!.init?.method).toBe('PATCH')
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ config: { address: 1, positions: [] } })
  })

  it('reads the moving head profiles of the catalog with defaults for missing ranges', async () => {
    const { fetchImpl } = recording(() => json(200, { profiles: { moving_head: { 'varytec-hero-wash-712z': { pan: { max: 540 }, tilt: { max: 190 }, zoom: { min: 6, max: 36 } }, odd: { pan: 'x' } } } }))
    expect(await client(fetchImpl).headProfiles()).toEqual({
      'varytec-hero-wash-712z': { pan: { max: 540 }, tilt: { max: 190 }, zoom: { min: 6, max: 36 } },
      odd: { pan: { max: 540 }, tilt: { max: 270 }, zoom: { min: 0, max: 100 } },
    })
    expect(await client(recording(() => json(200, {})).fetchImpl).headProfiles()).toEqual({})
  })
})

describe('StockaClient.listDevices', () => {
  const client = (fetchImpl: typeof fetch) => new StockaClient({ baseUrl: 'https://stocka.test', getToken: () => 'jwt', fetchImpl })

  it('maps the devices with their address and PIN, tolerating missing fields', async () => {
    const { calls, fetchImpl } = recording(() => json(200, [
      { id: 1, deviceId: 'uuid-1', name: 'Pessebre', localUrl: 'http://belen.local:8080', pin: '482913', hasPin: true, online: true, lastShowName: 'Nadal' },
      { id: 2, name: 'Sense res', localUrl: null, pin: null, hasPin: false, online: false },
      'nope',
    ]))

    const devices = await client(fetchImpl).listDevices('parròquia')

    expect(devices).toEqual([
      { id: 1, deviceId: 'uuid-1', name: 'Pessebre', localUrl: 'http://belen.local:8080', pin: '482913', hasPin: true, online: true, lastShowName: 'Nadal' },
      { id: 2, deviceId: null, name: 'Sense res', localUrl: null, pin: null, hasPin: false, online: false, lastShowName: null },
    ])
    expect(calls[0]!.url).toBe('https://stocka.test/organizations/parr%C3%B2quia/devices')
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer jwt')
  })

  it('treats a non-array body as no devices', async () => {
    const { fetchImpl } = recording(() => json(200, {}))
    expect(await client(fetchImpl).listDevices('x')).toEqual([])
  })

  it('maps the 403 of an organization without the hardware feature', async () => {
    const { fetchImpl } = recording(() => problem(403, { code: 'auth.forbidden', detail: 'No tens permís.' }))
    const err = (await client(fetchImpl).listDevices('x').catch((e: unknown) => e)) as StockaApiError
    expect(err.status).toBe(403)
  })
})
