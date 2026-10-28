import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'

import { PI_CODES, PiApiError, PiClient } from '../api/pi'
import { DEFAULT_PI_URL, IS_NATIVE, PI_POLL_MS, PI_URL_CANDIDATES } from '../config'
import { piErrorMessage } from '../errorMessages'
import { t } from '../i18n'
import { getBundleFiles, getKv, KEYS } from '../storage'
import { readJson, writeJson } from '../storage/kv'
import type { ImportReport, LibraryEntry, MotorDirection, OverrideMode, PiAlert, PiBundles, PiHardware, PiInfo, PiMotor, PiNet, PiSensor, PiStatus, PiTestParams, PiTestStatus, SavedDevice } from '../types'
import { normalizePiUrl } from '../util/url'
import { useAuthStore } from './auth'
import { useDevicesStore } from './devices'
import { useLogRelayStore } from './logRelay'
import { useUiStore } from './ui'

interface PiSettings {
  baseUrl: string
  pin: string | null
  name: string
  lastGoodUrl: string | null
}

export type UploadPhase = 'uploading' | 'verifying' | 'done' | 'error'

export interface UploadProgressState {
  fileName: string
  name: string
  sent: number
  total: number
  phase: UploadPhase
  status: number | null
  report: ImportReport | null
  error: string | null
}

type Action = () => Promise<void>

/** Kinds of port the player can test by hand (`TEST_KINDS` of its core). */
export const TESTABLE_KINDS: readonly string[] = ['relay', 'led_strip', 'led_segment', 'motor', 'audio', 'moving_head']

/** The Pi drops a test order after a minute: the app renews the ones still on well before. */
export const TEST_RENEW_MS = 20_000
/** The Pi stops a motor half a second after its last order: the app repeats it while the button is held. */
export const MOTOR_REFRESH_MS = 250
/** At most one live colour per port in this time while dragging the colour picker. */
export const TEST_LIVE_MS = 150
/** A just-sent order may not be in the status yet: only after this long does its absence mean the Pi dropped it. */
export const TEST_GRACE_MS = 3_000
/** While connected, the new log of the Pi is read (and sent to Stocka when possible) this often. */
export const LOG_RELAY_MS = 5 * 60_000

/** A test order the user switched on and the app keeps alive until it is switched off. */
interface TestOrder {
  params: PiTestParams
  sentAt: number
}

/** A sensor of the live status with its port name. */
export interface NamedSensor extends PiSensor {
  name: string
}

/** Alphabetical order of port names, ignoring case and accents, with numbers by value ("relé 2" before "relé 10"). */
function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/** Connection, live status and every command of the Raspberry Pi. */
export const usePiStore = defineStore('pi', () => {
  const ui = useUiStore()

  const baseUrl = ref<string>(DEFAULT_PI_URL)
  const pin = ref<string | null>(null)
  const name = ref('')
  const lastGoodUrl = ref<string | null>(null)
  const candidates = computed(() => {
    const list = [...PI_URL_CANDIDATES] as string[]
    if (lastGoodUrl.value && !list.includes(lastGoodUrl.value)) list.unshift(lastGoodUrl.value)
    return list
  })

  const info = shallowRef<PiInfo | null>(null)
  const status = shallowRef<PiStatus | null>(null)
  const bundles = shallowRef<PiBundles | null>(null)
  const net = shallowRef<PiNet | null>(null)
  const logs = ref<string[]>([])
  const connected = ref(false)
  const connecting = ref(false)
  const connectionError = ref<string | null>(null)
  const busy = ref(false)

  const pinDialogOpen = ref(false)
  const pinError = ref<string | null>(null)
  let pendingAfterPin: Action | null = null

  const upload = ref<UploadProgressState | null>(null)
  const activateAfterUpload = ref(true)
  let uploadAbort: AbortController | null = null
  const resumeIds = reactive<Record<string, string>>({})

  let unsubscribe: (() => void) | null = null
  let logRelayTimer: ReturnType<typeof setInterval> | null = null
  let statusFailures = 0

  const client = computed(() => new PiClient({ baseUrl: baseUrl.value, pin: pin.value, name: name.value || null }))
  /** Ports of the live status in alphabetical order. */
  const hardware = computed<PiHardware[]>(() => [...(status.value?.hardware ?? [])].sort((a, b) => compareNames(a.name, b.name)))
  const cutCount = computed(() => hardware.value.filter((h) => h.off).length)
  const playing = computed(() => status.value?.state === 'PLAYING')
  /** Alerts of the live status, newest first. */
  const alerts = computed<PiAlert[]>(() => [...(status.value?.alerts ?? [])].reverse())
  /** Sensors of the live status in alphabetical order. */
  const sensors = computed<NamedSensor[]>(() =>
    Object.entries(status.value?.sensors ?? {})
      .map(([sensorName, s]) => ({ ...s, name: sensorName }))
      .sort((a, b) => compareNames(a.name, b.name)),
  )
  /** Motors of the live status by port name. */
  const motors = computed<Record<string, PiMotor>>(() => status.value?.motors ?? {})
  const lockedMotors = computed(() => Object.keys(motors.value).filter((m) => motors.value[m]?.locked))

  /** Test orders switched on from this phone, by port. */
  const testOrders = reactive<Record<string, TestOrder>>({})
  /** The motor whose test button is being held, if any. */
  const heldMotor = ref<{ name: string; direction: MotorDirection } | null>(null)
  /** Audio files stored on the Pi, what an audio test can play. */
  const audioFiles = ref<string[]>([])
  let renewTimer: ReturnType<typeof setInterval> | null = null
  let motorTimer: ReturnType<typeof setInterval> | null = null
  let liveTimer: ReturnType<typeof setTimeout> | null = null
  const livePending = new Map<string, PiTestParams>()

  /** Ports can be tested while a show is loaded and nothing plays: no show, no rehearsal. */
  const canTest = computed(() => {
    const s = status.value
    return connected.value && !!s?.showHash && !s.rehearsal && (s.state === 'IDLE' || s.state === 'SAFE' || s.state === 'TEST')
  })
  /** Ports with a test order in force, as the Pi reports them or as this phone just sent them. */
  const testTargets = computed(() => new Set([...Object.keys(status.value?.test?.targets ?? {}), ...Object.keys(testOrders)]))

  // ---------------------------------------------------------------- settings

  async function init(): Promise<void> {
    const saved = await readJson<Partial<PiSettings>>(getKv(), KEYS.piSettings)
    if (saved) {
      if (typeof saved.baseUrl === 'string' && saved.baseUrl) baseUrl.value = saved.baseUrl
      pin.value = typeof saved.pin === 'string' ? saved.pin : null
      name.value = typeof saved.name === 'string' ? saved.name : ''
      lastGoodUrl.value = typeof saved.lastGoodUrl === 'string' ? saved.lastGoodUrl : null
    }
    const uploads = await readJson<Record<string, string>>(getKv(), KEYS.piUploads)
    if (uploads) Object.assign(resumeIds, uploads)
  }

  async function persistSettings(): Promise<void> {
    const settings: PiSettings = { baseUrl: baseUrl.value, pin: pin.value, name: name.value, lastGoodUrl: lastGoodUrl.value }
    await writeJson(getKv(), KEYS.piSettings, settings)
  }

  function setBaseUrl(url: string): void {
    const normalized = normalizePiUrl(url)
    if (normalized && normalized !== baseUrl.value) {
      disconnect()
      baseUrl.value = normalized
      void persistSettings()
    }
  }

  function setPin(nextPin: string, nextName: string): void {
    pin.value = nextPin.trim() || null
    name.value = nextName.trim().slice(0, 40)
    pinError.value = null
    void persistSettings()
  }

  function forgetPin(): void {
    pin.value = null
    void persistSettings()
  }

  // ---------------------------------------------------------------- connection

  /**
   * The Pi just reached (by any address) may be a device saved in Stocka with its PIN: without one
   * on the phone, take it, so commands work without typing it.
   */
  function adoptStockaPin(): void {
    if (pin.value) return
    const saved = useDevicesStore().find(baseUrl.value, info.value?.device.deviceId ?? null)
    if (saved?.pin) setPin(saved.pin, name.value)
  }

  /**
   * Connects to a player registered in Stocka with the address and PIN saved there: nothing to
   * type. A device without an address is ignored; without a PIN (a SPECTATOR) the one already on
   * the phone is kept, so reads work and writes ask for it.
   */
  async function connectTo(device: SavedDevice): Promise<boolean> {
    if (!device.localUrl) return false
    if (device.pin) setPin(device.pin, name.value)
    return connect(device.localUrl)
  }

  /** `GET /api/info` on the current address; on success loads everything and subscribes to status. */
  async function connect(url?: string): Promise<boolean> {
    if (url) setBaseUrl(url)
    connecting.value = true
    connectionError.value = null
    try {
      info.value = await client.value.info()
      connected.value = true
      lastGoodUrl.value = baseUrl.value
      adoptStockaPin()
      await persistSettings()
      await Promise.all([refreshStatus(), refreshBundles(), refreshNet(), refreshAudioFiles()])
      await syncClock()
      subscribe()
      startLogRelay()
      return true
    } catch (err) {
      connected.value = false
      connectionError.value = piErrorMessage(err)
      return false
    } finally {
      connecting.value = false
    }
  }

  function disconnect(): void {
    unsubscribe?.()
    unsubscribe = null
    forgetTests()
    stopLogRelay()
    connected.value = false
    info.value = null
    status.value = null
    bundles.value = null
    net.value = null
  }

  /** Carries the Pi's log to Stocka now and every {@link LOG_RELAY_MS} while connected (see `logRelay`). */
  function startLogRelay(): void {
    stopLogRelay()
    void relayLog()
    logRelayTimer = setInterval(() => void relayLog(), LOG_RELAY_MS)
  }

  function stopLogRelay(): void {
    if (logRelayTimer) clearInterval(logRelayTimer)
    logRelayTimer = null
  }

  async function relayLog(): Promise<void> {
    const device = info.value?.device.deviceId
    if (!connected.value || !device) return
    const relay = useLogRelayStore()
    await relay.collect(client.value, device)
    const auth = useAuthStore()
    if (auth.isAuthenticated) await relay.flush(auth.client)
  }

  function subscribe(): void {
    unsubscribe?.()
    statusFailures = 0
    unsubscribe = client.value.subscribeStatus(
      (snapshot) => {
        statusFailures = 0
        status.value = snapshot
        if (!connected.value) connected.value = true
      },
      {
        sse: !IS_NATIVE,
        pollMs: PI_POLL_MS,
        onError: () => {
          statusFailures++
          if (statusFailures >= 3) connected.value = false
        },
      },
    )
  }

  async function refreshInfo(): Promise<void> {
    info.value = await client.value.info()
  }

  async function refreshStatus(): Promise<void> {
    status.value = await client.value.status()
  }

  /** The Pi has no battery clock: when its time is not reliable, give it the phone's. Never fails the connection. */
  async function syncClock(): Promise<void> {
    if (!status.value?.clock || status.value.clock.reliable) return
    try {
      await client.value.syncClock()
      await refreshStatus()
    } catch {
      // without the time the Pi ignores the schedule and the button keeps working
    }
  }

  /** The audio files of the Pi; an older player without the endpoint just has none to test. */
  async function refreshAudioFiles(): Promise<void> {
    try {
      audioFiles.value = await client.value.audioFiles()
    } catch {
      audioFiles.value = []
    }
  }

  async function refreshBundles(): Promise<void> {
    bundles.value = await client.value.bundles()
  }

  async function refreshNet(): Promise<void> {
    try {
      net.value = await client.value.net()
    } catch {
      net.value = { enabled: false, mode: '', connected: false, hotspot: false, ssid: null, ip: null, known: [] }
    }
  }

  async function refreshLogs(n = 200): Promise<void> {
    logs.value = await client.value.logs(n)
  }

  // ---------------------------------------------------------------- guarded commands

  /**
   * Runs a write: a missing or wrong PIN opens the PIN dialog and the action is retried once the
   * PIN is entered; any other error becomes a toast.
   */
  async function guarded(action: Action, options: { busy?: boolean; retryAfterPin?: boolean } = {}): Promise<boolean> {
    const { busy: markBusy = true, retryAfterPin = true } = options
    if (markBusy) busy.value = true
    try {
      await action()
      return true
    } catch (err) {
      if (err instanceof PiApiError && err.needsPin) {
        pendingAfterPin = retryAfterPin ? action : null
        pinError.value = err.code === PI_CODES.pinInvalid ? piErrorMessage(err) : null
        pinDialogOpen.value = true
        return false
      }
      ui.toast(piErrorMessage(err), true)
      return false
    } finally {
      if (markBusy) busy.value = false
    }
  }

  function openPinDialog(): void {
    pinError.value = null
    pinDialogOpen.value = true
  }

  function cancelPinDialog(): void {
    pinDialogOpen.value = false
    pendingAfterPin = null
  }

  async function submitPin(nextPin: string, nextName: string): Promise<void> {
    setPin(nextPin, nextName)
    pinDialogOpen.value = false
    const action = pendingAfterPin
    pendingAfterPin = null
    if (action) await guarded(action)
  }

  const play = () =>
    guarded(async () => {
      // The Pi refuses to play in test mode: switch every test off first.
      if (status.value?.state === 'TEST') {
        forgetTests()
        await client.value.testRelease()
      }
      status.value = await client.value.play()
    })
  const stop = () => guarded(async () => void (status.value = await client.value.stop()))
  const panic = () => guarded(async () => void (status.value = await client.value.panic()))
  const endRehearsal = () => guarded(async () => void (status.value = await client.value.endRehearsal()))
  const rollback = () =>
    guarded(async () => {
      status.value = await client.value.rollback()
      await refreshBundles()
    })
  const activate = (hash: string) =>
    guarded(async () => {
      status.value = await client.value.activate(hash)
      await refreshBundles()
    })
  const deleteBundle = (hash: string) =>
    guarded(async () => {
      await client.value.deleteBundle(hash)
      await refreshBundles()
    })
  const setOverride = (target: string, mode: OverrideMode) =>
    guarded(async () => {
      await client.value.setOverride(target, mode)
      await refreshStatus()
    })
  const toggleOverride = (hw: PiHardware) => {
    if (!hw.off) forgetTest(hw.name) // cutting a port ends its test on the Pi
    return setOverride(hw.name, hw.off ? 'normal' : 'off')
  }
  const clearOverrides = () =>
    guarded(async () => {
      await client.value.clearOverrides()
      await refreshStatus()
    })
  const clearAlerts = () =>
    guarded(async () => {
      await client.value.clearAlerts()
      if (status.value) status.value = { ...status.value, alerts: [] }
      await refreshStatus()
    })
  /** Releases a motor locked after a timeout; tells the user when it was not locked any more. */
  const unlockMotor = (motorName: string) =>
    guarded(async () => {
      const result = await client.value.unlockMotor(motorName)
      if (status.value) status.value = { ...status.value, motors: result.motors }
      ui.toast(result.unlocked ? t('pi.motorUnlocked', { name: motorName }) : t('pi.motorNotLocked', { name: motorName }))
    })
  const setNetMode = (mode: 'ap' | 'auto') => guarded(async () => void (net.value = { ...(await client.value.setNetMode(mode)), enabled: true }))
  const hotspotNow = () => guarded(async () => void (net.value = { ...(await client.value.hotspotNow()), enabled: true }))
  const reboot = () =>
    guarded(async () => {
      const result = await client.value.reboot()
      ui.toast(result.message, !result.ok)
    })

  // ---------------------------------------------------------------- hardware test

  /** Puts the test state the Pi answered into the live status at once, without waiting for the next poll. */
  function applyTest(test: PiTestStatus): void {
    const s = status.value
    if (!s) return
    const state = test.active ? 'TEST' : s.state === 'TEST' ? 'IDLE' : s.state
    status.value = { ...s, test, state }
  }

  function forgetTest(target: string): void {
    delete testOrders[target]
    livePending.delete(target)
    if (heldMotor.value?.name === target) stopMotorTimer()
    if (Object.keys(testOrders).length === 0) stopRenewal()
  }

  function forgetTests(): void {
    for (const target of Object.keys(testOrders)) delete testOrders[target]
    livePending.clear()
    if (liveTimer) clearTimeout(liveTimer)
    liveTimer = null
    stopMotorTimer()
    stopRenewal()
  }

  /**
   * Switches a port on for a test (relay `{on: true}`, LEDs or head `{color}`, audio `{audio_name}`)
   * and keeps it on, renewing the order, until {@link testOff}. Sending other params changes it live.
   */
  function testOn(target: string, params: PiTestParams, options: { busy?: boolean } = {}): Promise<boolean> {
    return guarded(async () => {
      const test = await client.value.testSet(target, params)
      testOrders[target] = { params, sentAt: Date.now() }
      applyTest(test)
      startRenewal()
    }, options)
  }

  /** Switches a tested port off: the Pi leaves it safe and goes back to idle when nothing else is tested. */
  function testOff(target: string): Promise<boolean> {
    forgetTest(target)
    return guarded(async () => applyTest(await client.value.testRelease(target)))
  }

  /** Switches every test off. */
  function testOffAll(): Promise<boolean> {
    forgetTests()
    return guarded(async () => applyTest(await client.value.testRelease()))
  }

  /** A live change (dragging a colour): sends the latest params of each port at most every {@link TEST_LIVE_MS}. */
  function testLive(target: string, params: PiTestParams): void {
    livePending.set(target, params)
    if (!liveTimer) flushLive()
  }

  function flushLive(): void {
    const batch = [...livePending]
    livePending.clear()
    if (batch.length === 0) {
      liveTimer = null
      return
    }
    for (const [target, params] of batch) void testOn(target, params, { busy: false })
    liveTimer = setTimeout(flushLive, TEST_LIVE_MS)
  }

  function startRenewal(): void {
    renewTimer ??= setInterval(() => void renewTests(), TEST_RENEW_MS)
  }

  function stopRenewal(): void {
    if (renewTimer) clearInterval(renewTimer)
    renewTimer = null
  }

  /** Repeats every order still on (the Pi only extends it) and forgets the ones the Pi no longer has. */
  async function renewTests(): Promise<void> {
    dropTestsThePiForgot()
    for (const [target, order] of Object.entries(testOrders)) {
      try {
        applyTest(await client.value.testSet(target, order.params))
      } catch {
        forgetTest(target) // cut, show started, rehearsal, wrong PIN…: it is off now
      }
    }
    if (Object.keys(testOrders).length === 0) stopRenewal()
  }

  /** An order missing from the status for a while was ended on the Pi (panic, play, override, expiry). */
  function dropTestsThePiForgot(): void {
    const onPi = status.value?.test?.targets ?? {}
    const now = Date.now()
    for (const [target, order] of Object.entries(testOrders)) {
      if (!(target in onPi) && now - order.sentAt > TEST_GRACE_MS) forgetTest(target)
    }
  }

  /**
   * Turns a motor while its button is held: the order is repeated every {@link MOTOR_REFRESH_MS} and
   * the Pi stops the motor on its own half a second after the last one (so a lost phone stops it too).
   * One hold is one run, still cut by the limit switch and by `maxTime`.
   */
  function motorHold(target: string, direction: MotorDirection): void {
    if (heldMotor.value) motorRelease()
    if (!pin.value) {
      openPinDialog() // never replay a motor order after the PIN dialog
      return
    }
    heldMotor.value = { name: target, direction }
    const send = async () => {
      const ok = await guarded(async () => applyTest(await client.value.testSet(target, { direction })), { busy: false, retryAfterPin: false })
      if (!ok && heldMotor.value?.name === target) stopMotorTimer()
    }
    void send()
    motorTimer = setInterval(() => void send(), MOTOR_REFRESH_MS)
  }

  /** The motor button was let go: stop at once instead of waiting for the order to expire. */
  function motorRelease(): void {
    const held = heldMotor.value
    if (!held) return
    stopMotorTimer()
    void guarded(async () => applyTest(await client.value.testRelease(held.name)), { busy: false, retryAfterPin: false })
  }

  function stopMotorTimer(): void {
    if (motorTimer) clearInterval(motorTimer)
    motorTimer = null
    heldMotor.value = null
  }

  watch(status, (s) => {
    if (!s || Object.keys(testOrders).length === 0) return
    if (s.state === 'PLAYING' || s.rehearsal) forgetTests()
    else dropTestsThePiForgot()
  })

  // ---------------------------------------------------------------- upload

  function resumeKey(entry: LibraryEntry, size: number): string {
    return `${baseUrl.value}|${entry.fileName}|${size}`
  }

  async function rememberUploadId(key: string, id: string | null): Promise<void> {
    if (id) resumeIds[key] = id
    else delete resumeIds[key]
    await writeJson(getKv(), KEYS.piUploads, { ...resumeIds })
  }

  /** Sends a library bundle to the Pi, resuming a previous attempt of the same file when possible. */
  async function sendBundle(entry: LibraryEntry): Promise<void> {
    if (upload.value && (upload.value.phase === 'uploading' || upload.value.phase === 'verifying')) return
    const source = await getBundleFiles().openSource(entry.fileName)
    const key = resumeKey(entry, source.size)
    const state: UploadProgressState = reactive({
      fileName: entry.fileName,
      name: entry.name,
      sent: 0,
      total: source.size,
      phase: 'uploading',
      status: null,
      report: null,
      error: null,
    })
    uploadAbort = new AbortController()
    const signal = uploadAbort.signal

    await guarded(async () => {
      upload.value = state
      state.phase = 'uploading'
      state.error = null
      try {
        const result = await client.value.uploadBundle(source, {
          activate: activateAfterUpload.value,
          resumeUploadId: resumeIds[key] ?? null,
          onUploadId: (id) => void rememberUploadId(key, id),
          onProgress: (sent) => {
            state.sent = sent
          },
          onVerifying: () => {
            state.phase = 'verifying'
          },
          signal,
        })
        state.phase = 'done'
        state.status = result.status
        state.report = result.report
        await Promise.all([refreshBundles(), refreshStatus(), refreshAudioFiles()])
      } catch (err) {
        if (err instanceof PiApiError && err.needsPin) {
          // the PIN dialog takes over and re-runs this action; nothing to show meanwhile
          upload.value = null
        } else {
          state.phase = 'error'
          state.error = piErrorMessage(err)
        }
        throw err
      }
    })
  }

  function cancelUpload(): void {
    uploadAbort?.abort()
    uploadAbort = null
  }

  function dismissUpload(): void {
    if (upload.value && upload.value.phase !== 'uploading' && upload.value.phase !== 'verifying') upload.value = null
  }

  return {
    baseUrl,
    pin,
    name,
    lastGoodUrl,
    candidates,
    info,
    status,
    bundles,
    net,
    logs,
    connected,
    connecting,
    connectionError,
    busy,
    pinDialogOpen,
    pinError,
    upload,
    activateAfterUpload,
    client,
    hardware,
    cutCount,
    playing,
    alerts,
    sensors,
    motors,
    lockedMotors,
    testOrders,
    heldMotor,
    audioFiles,
    canTest,
    testTargets,
    init,
    setBaseUrl,
    setPin,
    forgetPin,
    connect,
    connectTo,
    disconnect,
    refreshInfo,
    refreshStatus,
    refreshBundles,
    refreshNet,
    refreshLogs,
    refreshAudioFiles,
    guarded,
    openPinDialog,
    cancelPinDialog,
    submitPin,
    play,
    stop,
    panic,
    endRehearsal,
    rollback,
    activate,
    deleteBundle,
    setOverride,
    toggleOverride,
    clearOverrides,
    clearAlerts,
    unlockMotor,
    setNetMode,
    hotspotNow,
    reboot,
    sendBundle,
    cancelUpload,
    dismissUpload,
    testOn,
    testOff,
    testOffAll,
    testLive,
    motorHold,
    motorRelease,
  }
})
