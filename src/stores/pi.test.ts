import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLocale } from '../i18n'
import { setStorage } from '../storage'
import { createMemoryBundleFiles } from '../storage/bundleFiles'
import { createMemoryKv } from '../storage/kv'
import type { PiAlert, PiMotor, PiStatus } from '../types'
import { usePiStore } from './pi'
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

    it('names the sensors and keeps the Pi order', () => {
      const pi = usePiStore()
      pi.status = baseStatus({
        sensors: {
          porta: { active: true, raw: false, onActive: 'stop_show', blocked: false, address: 'exp1:15' },
          boto: { active: false, raw: true, onActive: 'play', blocked: true, address: 'GPIO 20' },
        },
      })

      expect(pi.sensors.map((s) => s.name)).toEqual(['porta', 'boto'])
      expect(pi.sensors[1]).toMatchObject({ name: 'boto', blocked: true, address: 'GPIO 20', onActive: 'play' })
    })

    it('reports which motors are locked', () => {
      const pi = usePiStore()
      pi.status = baseStatus({ motors: { angel: motor({ locked: true }), estrella: motor({ direction: 'forward', runningS: 1.5 }) } })

      expect(pi.lockedMotors).toEqual(['angel'])
      expect(pi.motors.estrella?.direction).toBe('forward')
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
