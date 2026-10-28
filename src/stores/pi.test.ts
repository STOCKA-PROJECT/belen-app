import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { setLocale } from '../i18n'
import { setStorage } from '../storage'
import { createMemoryBundleFiles } from '../storage/bundleFiles'
import { createMemoryKv } from '../storage/kv'
import type { PiAlert, PiHardware, PiMotor, PiStatus, PiTestStatus, SavedDevice } from '../types'
import { useDevicesStore } from './devices'
import { MOTOR_REFRESH_MS, TEST_GRACE_MS, TEST_LIVE_MS, TEST_RENEW_MS, usePiStore } from './pi'
import { useUiStore } from './ui'

const PIN = '123456'

const motor = (overrides: Partial<PiMotor> = {}): PiMotor => ({
  direction: null,
  runningS: 0,
  lastEnd: null,
  locked: false,
  blocked: false,
  limitForward: null,
  limitReverse: null,
  ...overrides,
})

const alert = (overrides: Partial<PiAlert> = {}): PiAlert => ({ code: 'motor_timeout', port: 'angel', message: 'Temps màxim', at: '2026-10-21T14:00:00+00:00', ...overrides })

function baseStatus(overrides: Partial<PiStatus> = {}): PiStatus {
  return {
    state: 'IDLE',
    showHash: 'sha256:' + 'a'.repeat(64),
    showName: 'Pessebre',
    board: 'rpi4',
    durationMs: 1000,
    mode: { on: 'once', cycles: 1 },
    cycle: 0,
    cyclesTarget: null,
    cycleMs: 0,
    overrides: [],
    hardware: [],
    active: null,
    previous: null,
    lastError: null,
    uptimeS: 10,
    freeBytes: 1,
    version: 'test',
    ...overrides,
  }
}

interface FakeCall {
  method: string
  path: string
  authorization: string | undefined
}

/** A stateful fake of the Pi endpoints the store calls for alerts and motors. */
function installFakePi(initial: PiStatus, unlockAnswer: (name: string) => Response | null = () => null) {
  let current = initial
  const calls: FakeCall[] = []
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()
    const path = new URL(String(input), 'http://pi').pathname.replace(/^\/__pi/, '')
    const headers = (init?.headers as Record<string, string>) ?? {}
    calls.push({ method, path, authorization: headers.Authorization })
    const pinDenied = () => {
      if (!headers.Authorization) return json(401, { error: 'pin_required', message: 'Hace falta el PIN' })
      if (headers.Authorization !== `Pin ${PIN}`) return json(401, { error: 'pin_invalid', message: 'PIN incorrecto' })
      return null
    }
    if (method === 'GET' && path === '/api/status') return json(200, current)
    if (method === 'DELETE' && path === '/api/rehearsal') {
      const denied = pinDenied()
      if (denied) return denied
      current = { ...current, rehearsal: null, showName: 'Pessebre actiu' }
      return json(200, current)
    }
    if (method === 'DELETE' && path === '/api/alerts') {
      const denied = pinDenied()
      if (denied) return denied
      const cleared = current.alerts?.length ?? 0
      current = { ...current, alerts: [] }
      return json(200, { cleared, alerts: [] })
    }
    const m = /^\/api\/motors\/([^/]+)\/unlock$/.exec(path)
    if (method === 'POST' && m) {
      const denied = pinDenied()
      if (denied) return denied
      const name = decodeURIComponent(m[1]!)
      const custom = unlockAnswer(name)
      if (custom) return custom
      const motors = { ...(current.motors ?? {}) }
      const was = motors[name]
      if (!was) return json(404, { error: 'unknown_target', message: `Motor desconocido: ${name}` })
      motors[name] = { ...was, locked: false }
      current = { ...current, motors }
      return json(200, { motor: name, unlocked: was.locked, motors })
    }
    return json(404, { error: 'not_found', message: path })
  })
  vi.stubGlobal('fetch', fetchImpl)
  return { calls, writes: () => calls.filter((c) => c.method !== 'GET') }
}

describe('pi store: alerts, sensors and motors', () => {
  beforeEach(() => {
    setStorage({ kv: createMemoryKv(), files: createMemoryBundleFiles() })
    setActivePinia(createPinia())
    setLocale('ca')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('derived state', () => {
    it('is empty without a status', () => {
      const pi = usePiStore()

      expect(pi.alerts).toEqual([])
      expect(pi.sensors).toEqual([])
      expect(pi.motors).toEqual({})
      expect(pi.lockedMotors).toEqual([])
    })

    it('is empty when an older player omits the new fields', () => {
      const pi = usePiStore()
      pi.status = baseStatus()

      expect(pi.alerts).toEqual([])
      expect(pi.sensors).toEqual([])
      expect(pi.motors).toEqual({})
    })

    it('lists alerts newest first without mutating the status', () => {
      const pi = usePiStore()
      const older = alert({ at: '2026-10-21T13:00:00+00:00' })
      const newer = alert({ code: 'sensor_panic', port: 'porta', at: '2026-10-21T14:00:00+00:00' })
      pi.status = baseStatus({ alerts: [older, newer] })

      expect(pi.alerts).toEqual([newer, older])
      expect(pi.status!.alerts).toEqual([older, newer])
    })

    it('names the sensors and sorts them alphabetically', () => {
      const pi = usePiStore()
      pi.status = baseStatus({
        sensors: {
          porta: { active: true, raw: false, onActive: 'stop_show', blocked: false, address: 'exp1:15' },
          boto: { active: false, raw: true, onActive: 'play', blocked: true, address: 'GPIO 20' },
        },
      })

      expect(pi.sensors.map((s) => s.name)).toEqual(['boto', 'porta'])
      expect(pi.sensors[0]).toMatchObject({ name: 'boto', blocked: true, address: 'GPIO 20', onActive: 'play' })
    })

    it('sorts the ports alphabetically, ignoring case and with numbers by value', () => {
      const pi = usePiStore()
      const hw = (name: string): PiHardware => ({ name, kind: 'relay', off: false })
      pi.status = baseStatus({ hardware: [hw('relé 10'), hw('Àngel'), hw('relé 2'), hw('bou')] })

      expect(pi.hardware.map((h) => h.name)).toEqual(['Àngel', 'bou', 'relé 2', 'relé 10'])
      expect(pi.status!.hardware.map((h) => h.name)).toEqual(['relé 10', 'Àngel', 'relé 2', 'bou'])
    })

    it('reports which motors are locked', () => {
      const pi = usePiStore()
      pi.status = baseStatus({ motors: { angel: motor({ locked: true }), estrella: motor({ direction: 'forward', runningS: 1.5 }) } })

      expect(pi.lockedMotors).toEqual(['angel'])
      expect(pi.motors.estrella?.direction).toBe('forward')
    })
  })

  describe('endRehearsal', () => {
    const rehearsal = { fromMs: 310_000, toMs: 340_000, loop: true, startedAt: '2026-10-23T12:00:00+00:00', showHash: null, showName: 'Assaig', showTimelineId: 1, skippedMotors: [] }

    it('ends the rehearsal with the PIN and shows the active show again', async () => {
      const fake = installFakePi(baseStatus({ rehearsal }))
      const pi = usePiStore()
      pi.setPin(PIN, 'Joan')
      await pi.refreshStatus()
      expect(pi.status?.rehearsal?.fromMs).toBe(310_000)

      await pi.endRehearsal()

      expect(fake.writes()).toEqual([{ method: 'DELETE', path: '/api/rehearsal', authorization: `Pin ${PIN}` }])
      expect(pi.status?.rehearsal).toBeNull()
      expect(pi.status?.showName).toBe('Pessebre actiu')
    })

    it('asks for the PIN first when there is none', async () => {
      const fake = installFakePi(baseStatus({ rehearsal }))
      const pi = usePiStore()
      await pi.refreshStatus()

      await pi.endRehearsal()

      expect(pi.pinDialogOpen).toBe(true)
      expect(fake.writes()).toEqual([])
      await pi.submitPin(PIN, 'Joan')
      expect(fake.writes()).toEqual([{ method: 'DELETE', path: '/api/rehearsal', authorization: `Pin ${PIN}` }])
      expect(pi.status?.rehearsal).toBeNull()
    })
  })

  describe('clearAlerts', () => {
    it('deletes the alerts with the PIN and empties them at once', async () => {
      const fake = installFakePi(baseStatus({ alerts: [alert(), alert({ code: 'sensor_stop_show', port: 'porta' })] }))
      const pi = usePiStore()
      pi.setPin(PIN, 'Joan')
      await pi.refreshStatus()
      expect(pi.alerts).toHaveLength(2)

      await pi.clearAlerts()

      expect(fake.writes()).toEqual([{ method: 'DELETE', path: '/api/alerts', authorization: `Pin ${PIN}` }])
      expect(pi.alerts).toEqual([])
      expect(pi.pinDialogOpen).toBe(false)
    })

    it('opens the PIN dialog without a PIN and retries once it is entered', async () => {
      const fake = installFakePi(baseStatus({ alerts: [alert()] }))
      const pi = usePiStore()
      await pi.refreshStatus()

      await pi.clearAlerts()

      expect(pi.pinDialogOpen).toBe(true)
      expect(pi.pinError).toBeNull()
      expect(fake.writes()).toEqual([])
      expect(pi.alerts).toHaveLength(1)

      await pi.submitPin(PIN, 'Joan')

      expect(pi.pinDialogOpen).toBe(false)
      expect(fake.writes()).toEqual([{ method: 'DELETE', path: '/api/alerts', authorization: `Pin ${PIN}` }])
      expect(pi.alerts).toEqual([])
    })

    it('reopens the PIN dialog with an error when the PIN is wrong', async () => {
      installFakePi(baseStatus({ alerts: [alert()] }))
      const pi = usePiStore()
      pi.setPin('000000', '')
      await pi.refreshStatus()

      await pi.clearAlerts()

      expect(pi.pinDialogOpen).toBe(true)
      expect(pi.pinError).toBe('PIN incorrecte.')
      expect(pi.alerts).toHaveLength(1)
    })

    it('drops the pending action when the PIN dialog is cancelled', async () => {
      const fake = installFakePi(baseStatus({ alerts: [alert()] }))
      const pi = usePiStore()

      await pi.clearAlerts()
      pi.cancelPinDialog()
      await pi.submitPin(PIN, '')

      expect(fake.writes()).toEqual([])
    })
  })

  describe('unlockMotor', () => {
    it('unlocks a locked motor, updates the motors and confirms it', async () => {
      const fake = installFakePi(baseStatus({ motors: { angel: motor({ locked: true, lastEnd: 'max_time' }) }, alerts: [alert({ locked: true })] }))
      const pi = usePiStore()
      const ui = useUiStore()
      pi.setPin(PIN, 'Joan')
      await pi.refreshStatus()

      await pi.unlockMotor('angel')

      expect(fake.writes()).toEqual([{ method: 'POST', path: '/api/motors/angel/unlock', authorization: `Pin ${PIN}` }])
      expect(pi.motors.angel?.locked).toBe(false)
      expect(pi.lockedMotors).toEqual([])
      expect(ui.toasts.at(-1)).toMatchObject({ message: 'Motor «angel» desbloquejat.', error: false })
    })

    it('says so when the motor was no longer locked (unlocked=false)', async () => {
      installFakePi(baseStatus({ motors: { angel: motor({ locked: false }) } }))
      const pi = usePiStore()
      const ui = useUiStore()
      pi.setPin(PIN, '')
      await pi.refreshStatus()

      await pi.unlockMotor('angel')

      expect(ui.toasts.at(-1)).toMatchObject({ message: 'El motor «angel» ja no estava bloquejat.', error: false })
      expect(pi.motors.angel?.locked).toBe(false)
    })

    it('opens the PIN dialog without a PIN and unlocks after it is entered', async () => {
      const fake = installFakePi(baseStatus({ motors: { angel: motor({ locked: true }) } }))
      const pi = usePiStore()
      await pi.refreshStatus()

      await pi.unlockMotor('angel')

      expect(pi.pinDialogOpen).toBe(true)
      expect(fake.writes()).toEqual([])
      expect(pi.lockedMotors).toEqual(['angel'])

      await pi.submitPin(PIN, '')

      expect(fake.writes()).toHaveLength(1)
      expect(pi.lockedMotors).toEqual([])
    })

    it('shows an error toast for an unknown motor and keeps the state', async () => {
      installFakePi(baseStatus({ motors: { angel: motor({ locked: true }) } }))
      const pi = usePiStore()
      const ui = useUiStore()
      pi.setPin(PIN, '')
      await pi.refreshStatus()

      await pi.unlockMotor('llum')

      expect(ui.toasts.at(-1)).toMatchObject({ message: 'Motor desconocido: llum', error: true })
      expect(pi.lockedMotors).toEqual(['angel'])
      expect(pi.pinDialogOpen).toBe(false)
    })

    it('updates the motors even before any status was loaded', async () => {
      installFakePi(baseStatus({ motors: { angel: motor({ locked: true }) } }))
      const pi = usePiStore()
      pi.setPin(PIN, '')

      await pi.unlockMotor('angel')

      expect(pi.status).toBeNull()
      expect(pi.busy).toBe(false)
    })
  })
})

describe('pi store: clock sync on connect', () => {
  beforeEach(() => {
    setStorage({ kv: createMemoryKv(), files: createMemoryBundleFiles() })
    setActivePinia(createPinia())
    setLocale('ca')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** The endpoints `connect` reads, plus `/api/clock` answering `clockStatus`. */
  function installConnectPi(reliable: boolean, clockStatus = 200) {
    let clock = { reliable, source: reliable ? 'ntp' : null, now: '2026-10-23T18:30:00' }
    const posts: Array<{ body: unknown; authorization: string | undefined }> = []
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      const path = new URL(String(input), 'http://pi').pathname.replace(/^\/__pi/, '')
      if (method === 'GET' && path === '/api/info') return json(200, { device: { name: 'Pessebre' }, version: 't', uptimeS: 1, freeBytes: 1 })
      if (method === 'GET' && path === '/api/status') return json(200, baseStatus({ clock } as Partial<PiStatus>))
      if (method === 'GET' && path === '/api/bundles') return json(200, { active: null, previous: null, bundles: [] })
      if (method === 'GET' && path === '/api/net') return json(200, { enabled: false })
      if (method === 'POST' && path === '/api/clock') {
        posts.push({ body: JSON.parse(String(init?.body)), authorization: (init?.headers as Record<string, string>)?.Authorization })
        if (clockStatus !== 200) return json(clockStatus, { error: 'not_found', message: 'no' })
        clock = { reliable: true, source: 'client', now: clock.now }
        return json(200, { ...clock, adjusted: true, offsetMs: 1000 })
      }
      return json(404, { error: 'not_found', message: path })
    }))
    return posts
  }

  it('gives the Pi the phone time when its clock is not reliable, without PIN', async () => {
    const posts = installConnectPi(false)
    const store = usePiStore()
    expect(await store.connect()).toBe(true)
    expect(posts).toHaveLength(1)
    expect(typeof (posts[0]!.body as { epochMs: number }).epochMs).toBe('number')
    expect(posts[0]!.authorization).toBeUndefined()
    expect(store.status?.clock?.reliable).toBe(true)
    store.disconnect()
  })

  it('leaves a reliable clock alone', async () => {
    const posts = installConnectPi(true)
    const store = usePiStore()
    expect(await store.connect()).toBe(true)
    expect(posts).toHaveLength(0)
    store.disconnect()
  })

  it('still connects when the Pi refuses or lacks the endpoint', async () => {
    const posts = installConnectPi(false, 404)
    const store = usePiStore()
    expect(await store.connect()).toBe(true)
    expect(posts).toHaveLength(1)
    expect(store.status?.clock?.reliable).toBe(false)
    store.disconnect()
  })
})

describe('pi store: connecting to a device saved in Stocka', () => {
  beforeEach(() => {
    setStorage({ kv: createMemoryKv(), files: createMemoryBundleFiles() })
    setActivePinia(createPinia())
    setLocale('ca')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const saved = (overrides: Partial<SavedDevice> = {}): SavedDevice => ({
    id: 7,
    deviceId: 'uuid-7',
    name: 'Pessebre parròquia',
    localUrl: 'http://belen.local:8080',
    pin: '482913',
    hasPin: true,
    online: false,
    lastShowName: null,
    orgSlug: 'parroquia',
    orgName: 'Parròquia',
    ...overrides,
  })

  /** A Pi answering the reads `connect` makes, at any address; records the hosts asked. */
  function installAnyPi() {
    const hosts: string[] = []
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://pi')
      hosts.push(url.host)
      const path = url.pathname.replace(/^\/__pi/, '')
      if (path === '/api/info') return json(200, { device: { name: 'belen', deviceId: 'uuid-7' }, version: 't', uptimeS: 1, freeBytes: 1 })
      if (path === '/api/status') return json(200, baseStatus())
      if (path === '/api/bundles') return json(200, { active: null, previous: null, shows: [] })
      if (path === '/api/net') return json(200, { enabled: false })
      if (path === '/api/assets') return json(200, { audio: [] })
      return json(404, { error: 'not_found', message: path })
    }))
    return hosts
  }

  it('takes the address and the PIN from the device and connects', async () => {
    const hosts = installAnyPi()
    const store = usePiStore()

    expect(await store.connectTo(saved())).toBe(true)

    expect(store.baseUrl).toBe('http://belen.local:8080')
    expect(store.pin).toBe('482913')
    expect(store.connected).toBe(true)
    expect(hosts[0]).toBe('belen.local:8080')
    store.disconnect()
  })

  it('keeps the PIN already on the phone when Stocka does not give one (a SPECTATOR)', async () => {
    installAnyPi()
    const store = usePiStore()
    store.setPin('111111', 'Joan')

    expect(await store.connectTo(saved({ pin: null, hasPin: false, localUrl: 'http://10.42.0.1:8080' }))).toBe(true)

    expect(store.pin).toBe('111111')
    expect(store.baseUrl).toBe('http://10.42.0.1:8080')
    store.disconnect()
  })

  it('refuses a device without an address and touches nothing', async () => {
    const hosts = installAnyPi()
    const store = usePiStore()
    const before = store.baseUrl

    expect(await store.connectTo(saved({ localUrl: null }))).toBe(false)

    expect(store.baseUrl).toBe(before)
    expect(hosts).toEqual([])
  })

  it('takes the PIN of the matching Stocka device when the Pi is reached by another address', async () => {
    installAnyPi()
    const devices = useDevicesStore()
    devices.devices = [saved({ localUrl: 'http://belen.local:8080' })]
    const store = usePiStore()

    expect(await store.connect('http://10.42.0.1:8080')).toBe(true) // the Pi reports uuid-7

    expect(store.pin).toBe('482913')
    store.disconnect()
  })

  it('never replaces a PIN already on the phone with the one of Stocka', async () => {
    installAnyPi()
    useDevicesStore().devices = [saved()]
    const store = usePiStore()
    store.setPin('111111', 'Joan')

    await store.connect('http://belen.local:8080')

    expect(store.pin).toBe('111111')
    store.disconnect()
  })

  it('remembers the address and PIN of the device for the next start', async () => {
    const kv = createMemoryKv()
    setStorage({ kv, files: createMemoryBundleFiles() })
    installAnyPi()
    await usePiStore().connectTo(saved())

    setActivePinia(createPinia())
    const store = usePiStore()
    await store.init()

    expect(store.baseUrl).toBe('http://belen.local:8080')
    expect(store.pin).toBe('482913')
  })
})

describe('pi store: hardware test', () => {
  const SHOW = 'sha256:' + 'a'.repeat(64)
  const HARDWARE: PiHardware[] = [
    { name: 'Sembra', kind: 'relay', off: false, pieces: ['Blat'] },
    { name: 'Casa', kind: 'led_segment', off: false },
    { name: 'Angel', kind: 'motor', off: false },
    { name: 'Audio', kind: 'audio', off: false },
  ]

  interface TestCall {
    method: string
    path: string
    body: Record<string, unknown> | null
    authorization: string | undefined
  }

  /** A stateful fake of the test endpoints: orders by target, state TEST while there is any. */
  function installTestPi(options: { refuse?: Record<string, { status: number; error: string }> } = {}) {
    const orders: Record<string, Record<string, unknown>> = {}
    let state: PiStatus['state'] = 'IDLE'
    const calls: TestCall[] = []
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
    const test = (): PiTestStatus => ({
      active: state === 'TEST',
      targets: Object.fromEntries(Object.entries(orders).map(([target, params]) => [target, { kind: 'x', params, expiresInS: 60 }])),
    })
    const statusNow = () => baseStatus({ state, showHash: SHOW, hardware: HARDWARE, test: test() })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      const path = new URL(String(input), 'http://pi').pathname.replace(/^\/__pi/, '')
      const headers = (init?.headers as Record<string, string>) ?? {}
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
      calls.push({ method, path, body, authorization: headers.Authorization })
      if (method === 'GET' && path === '/api/status') return json(200, statusNow())
      if (headers.Authorization !== `Pin ${PIN}`) return json(401, { error: headers.Authorization ? 'pin_invalid' : 'pin_required', message: 'PIN' })
      if (method === 'POST' && path === '/api/test/set') {
        const target = String(body?.target)
        const refused = options.refuse?.[target]
        if (refused) return json(refused.status, { error: refused.error, message: refused.error })
        orders[target] = body?.params as Record<string, unknown>
        state = 'TEST'
        return json(200, test())
      }
      if (method === 'POST' && path === '/api/test/release') {
        if (typeof body?.target === 'string') delete orders[body.target]
        else for (const target of Object.keys(orders)) delete orders[target]
        if (Object.keys(orders).length === 0 && state === 'TEST') state = 'IDLE'
        return json(200, test())
      }
      if (method === 'POST' && path === '/api/play') {
        if (state === 'TEST') return json(409, { error: 'test_mode', message: 'Sal del modo prueba' })
        state = 'PLAYING'
        return json(200, statusNow())
      }
      if (method === 'PUT' && path === '/api/overrides') {
        delete orders[String(body?.target)]
        return json(200, { off: [body?.target], hardware: HARDWARE })
      }
      return json(404, { error: 'not_found', message: path })
    }))
    return {
      calls,
      orders,
      /** What the Pi would push in its next status snapshot. */
      statusNow,
      setState: (next: PiStatus['state']) => void (state = next),
      sets: () => calls.filter((c) => c.path === '/api/test/set'),
      releases: () => calls.filter((c) => c.path === '/api/test/release'),
    }
  }

  function connectedStore(status: Partial<PiStatus> = {}, pin: string | null = PIN) {
    const store = usePiStore()
    if (pin) store.setPin(pin, 'Joan')
    store.connected = true
    store.status = baseStatus({ showHash: SHOW, hardware: HARDWARE, ...status })
    return store
  }

  beforeEach(() => {
    setStorage({ kv: createMemoryKv(), files: createMemoryBundleFiles() })
    setActivePinia(createPinia())
    setLocale('ca')
    vi.useFakeTimers()
  })

  afterEach(() => {
    usePiStore().disconnect()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('canTest', () => {
    it.each([['IDLE'], ['SAFE'], ['TEST']] as const)('allows tests in %s with a show loaded', (state) => {
      installTestPi()
      expect(connectedStore({ state }).canTest).toBe(true)
    })

    it.each([
      ['a show is playing', { state: 'PLAYING' as const }],
      ['no show is loaded', { showHash: null }],
      ['a rehearsal from the editor runs', { rehearsal: { fromMs: 0, toMs: 1, loop: false, startedAt: '', showHash: null, showName: null, showTimelineId: null, skippedMotors: [] } }],
      ['the player is booting', { state: 'BOOT' as const }],
    ])('refuses tests when %s', (_label, status) => {
      installTestPi()
      expect(connectedStore(status).canTest).toBe(false)
    })

    it('refuses tests while disconnected', () => {
      installTestPi()
      const store = connectedStore()
      store.connected = false
      expect(store.canTest).toBe(false)
    })
  })

  describe('switching a port on and off', () => {
    it('sends the order with the PIN and shows the port as tested at once', async () => {
      const pi = installTestPi()
      const store = connectedStore()

      expect(await store.testOn('Sembra', { on: true })).toBe(true)

      expect(pi.sets()).toEqual([{ method: 'POST', path: '/api/test/set', body: { target: 'Sembra', params: { on: true } }, authorization: `Pin ${PIN}` }])
      expect(store.status?.state).toBe('TEST')
      expect(store.testTargets.has('Sembra')).toBe(true)
    })

    it('switches it off with a release of that port and goes back to idle', async () => {
      const pi = installTestPi()
      const store = connectedStore()
      await store.testOn('Sembra', { on: true })

      await store.testOff('Sembra')

      expect(pi.releases().at(-1)!.body).toEqual({ target: 'Sembra' })
      expect(store.status?.state).toBe('IDLE')
      expect(store.testTargets.has('Sembra')).toBe(false)
      expect(store.testOrders).toEqual({})
    })

    it('switches every test off at once', async () => {
      const pi = installTestPi()
      const store = connectedStore()
      await store.testOn('Sembra', { on: true })
      await store.testOn('Casa', { color: [255, 0, 0] })

      await store.testOffAll()

      expect(pi.releases().at(-1)!.body).toEqual({})
      expect(store.testTargets.size).toBe(0)
      expect(store.status?.state).toBe('IDLE')
    })

    it('asks for the PIN first and switches the port on once it is entered', async () => {
      const pi = installTestPi()
      const store = connectedStore({}, null)

      expect(await store.testOn('Sembra', { on: true })).toBe(false)
      expect(store.pinDialogOpen).toBe(true)
      expect(pi.sets()).toHaveLength(0)

      await store.submitPin(PIN, 'Joan')

      expect(pi.sets()).toHaveLength(1)
      expect(store.testTargets.has('Sembra')).toBe(true)
    })

    it('shows the refusal and keeps the port off when the Pi says no', async () => {
      installTestPi({ refuse: { Sembra: { status: 409, error: 'target_off' } } })
      const store = connectedStore()

      expect(await store.testOn('Sembra', { on: true })).toBe(false)

      expect(useUiStore().toasts.at(-1)?.error).toBe(true)
      expect(store.testTargets.has('Sembra')).toBe(false)
    })
  })

  describe('keeping a port on until it is switched off', () => {
    it('renews the same order before the Pi lets it expire', async () => {
      const pi = installTestPi()
      const store = connectedStore()
      await store.testOn('Sembra', { on: true })
      store.status = pi.statusNow()

      await vi.advanceTimersByTimeAsync(TEST_RENEW_MS)

      expect(pi.sets().map((c) => c.body)).toEqual([{ target: 'Sembra', params: { on: true } }, { target: 'Sembra', params: { on: true } }])
    })

    it('stops renewing once the port is switched off', async () => {
      const pi = installTestPi()
      const store = connectedStore()
      await store.testOn('Sembra', { on: true })
      await store.testOff('Sembra')

      await vi.advanceTimersByTimeAsync(TEST_RENEW_MS * 3)

      expect(pi.sets()).toHaveLength(1)
    })

    it('forgets an order the Pi dropped (panic, expiry) instead of switching it on again', async () => {
      const pi = installTestPi()
      const store = connectedStore()
      await store.testOn('Sembra', { on: true })
      delete pi.orders.Sembra
      await vi.advanceTimersByTimeAsync(TEST_GRACE_MS + 1)

      store.status = baseStatus({ state: 'SAFE', showHash: SHOW, hardware: HARDWARE, test: { active: false, targets: {} } })
      await nextTick()

      expect(store.testOrders).toEqual({})
      await vi.advanceTimersByTimeAsync(TEST_RENEW_MS)
      expect(pi.sets()).toHaveLength(1)
    })

    it('keeps a just-sent order the status does not list yet', async () => {
      installTestPi()
      const store = connectedStore()
      await store.testOn('Sembra', { on: true })

      store.status = baseStatus({ state: 'TEST', showHash: SHOW, hardware: HARDWARE, test: { active: true, targets: {} } })
      await nextTick()

      expect(store.testOrders).toHaveProperty('Sembra')
    })

    it('forgets every order when a show starts', async () => {
      installTestPi()
      const store = connectedStore()
      await store.testOn('Sembra', { on: true })

      store.status = baseStatus({ state: 'PLAYING', showHash: SHOW, hardware: HARDWARE })
      await nextTick()

      expect(store.testOrders).toEqual({})
    })

    it('forgets the order of a port that gets cut', async () => {
      installTestPi()
      const store = connectedStore()
      await store.testOn('Sembra', { on: true })

      await store.toggleOverride(HARDWARE[0]!)

      expect(store.testOrders).not.toHaveProperty('Sembra')
    })

    it('forgets everything on disconnect', async () => {
      const pi = installTestPi()
      const store = connectedStore()
      await store.testOn('Sembra', { on: true })

      store.disconnect()
      await vi.advanceTimersByTimeAsync(TEST_RENEW_MS * 2)

      expect(store.testOrders).toEqual({})
      expect(pi.sets()).toHaveLength(1)
    })
  })

  describe('live colour', () => {
    it('sends the first colour at once and only the latest one per interval', async () => {
      const pi = installTestPi()
      const store = connectedStore()

      store.testLive('Casa', { color: [1, 0, 0] })
      store.testLive('Casa', { color: [2, 0, 0] })
      store.testLive('Casa', { color: [3, 0, 0] })
      await vi.advanceTimersByTimeAsync(TEST_LIVE_MS)
      await vi.advanceTimersByTimeAsync(TEST_LIVE_MS)

      expect(pi.sets().map((c) => c.body?.params)).toEqual([{ color: [1, 0, 0] }, { color: [3, 0, 0] }])
      expect(store.busy).toBe(false)
    })
  })

  describe('motors', () => {
    it('repeats the direction while the button is held and releases the motor when it is let go', async () => {
      const pi = installTestPi()
      const store = connectedStore()

      store.motorHold('Angel', 'forward')
      await vi.advanceTimersByTimeAsync(MOTOR_REFRESH_MS * 3)

      expect(pi.sets().length).toBe(4)
      expect(pi.sets().every((c) => (c.body?.params as { direction: string }).direction === 'forward')).toBe(true)
      expect(store.heldMotor).toEqual({ name: 'Angel', direction: 'forward' })

      store.motorRelease()
      await vi.advanceTimersByTimeAsync(MOTOR_REFRESH_MS * 4)

      expect(store.heldMotor).toBeNull()
      expect(pi.sets().length).toBe(4)
      expect(pi.releases().at(-1)!.body).toEqual({ target: 'Angel' })
    })

    it('holding the other direction releases the first one', async () => {
      const pi = installTestPi()
      const store = connectedStore()
      store.motorHold('Angel', 'forward')
      await vi.advanceTimersByTimeAsync(0)

      store.motorHold('Angel', 'reverse')
      await vi.advanceTimersByTimeAsync(0)

      expect(pi.releases()).toHaveLength(1)
      expect(pi.sets().at(-1)!.body?.params).toEqual({ direction: 'reverse' })
      expect(store.heldMotor?.direction).toBe('reverse')
    })

    it('stops repeating when the Pi refuses the motor', async () => {
      const pi = installTestPi({ refuse: { Angel: { status: 409, error: 'target_off' } } })
      const store = connectedStore()

      store.motorHold('Angel', 'forward')
      await vi.advanceTimersByTimeAsync(MOTOR_REFRESH_MS * 4)

      expect(pi.sets()).toHaveLength(1)
      expect(store.heldMotor).toBeNull()
    })

    it('without a PIN asks for it and never replays the motor order afterwards', async () => {
      const pi = installTestPi()
      const store = connectedStore({}, null)

      store.motorHold('Angel', 'forward')
      expect(store.pinDialogOpen).toBe(true)
      await store.submitPin(PIN, 'Joan')
      await vi.advanceTimersByTimeAsync(MOTOR_REFRESH_MS * 2)

      expect(pi.sets()).toHaveLength(0)
      expect(store.heldMotor).toBeNull()
    })

    it('letting go with nothing held does nothing', () => {
      const pi = installTestPi()
      const store = connectedStore()

      store.motorRelease()

      expect(pi.calls).toHaveLength(0)
    })
  })

  describe('play', () => {
    it('switches the tests off before starting the show', async () => {
      const pi = installTestPi()
      const store = connectedStore()
      await store.testOn('Sembra', { on: true })

      await store.play()

      expect(pi.releases().at(-1)!.body).toEqual({})
      expect(store.status?.state).toBe('PLAYING')
      expect(store.testOrders).toEqual({})
    })
  })
})
