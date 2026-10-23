import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'

import { PI_CODES, PiApiError, PiClient } from '../api/pi'
import { DEFAULT_PI_URL, IS_NATIVE, PI_POLL_MS, PI_URL_CANDIDATES } from '../config'
import { piErrorMessage } from '../errorMessages'
import { t } from '../i18n'
import { getBundleFiles, getKv, KEYS } from '../storage'
import { readJson, writeJson } from '../storage/kv'
import type { ImportReport, LibraryEntry, OverrideMode, PiAlert, PiBundles, PiHardware, PiInfo, PiMotor, PiNet, PiSensor, PiStatus } from '../types'
import { normalizePiUrl } from '../util/url'
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

/** A sensor of the live status with its port name. */
export interface NamedSensor extends PiSensor {
  name: string
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
  let statusFailures = 0

  const client = computed(() => new PiClient({ baseUrl: baseUrl.value, pin: pin.value, name: name.value || null }))
  const hardware = computed<PiHardware[]>(() => status.value?.hardware ?? [])
  const cutCount = computed(() => hardware.value.filter((h) => h.off).length)
  const playing = computed(() => status.value?.state === 'PLAYING')
  /** Alerts of the live status, newest first. */
  const alerts = computed<PiAlert[]>(() => [...(status.value?.alerts ?? [])].reverse())
  /** Sensors of the live status, in the order the Pi lists them. */
  const sensors = computed<NamedSensor[]>(() => Object.entries(status.value?.sensors ?? {}).map(([sensorName, s]) => ({ ...s, name: sensorName })))
  /** Motors of the live status by port name. */
  const motors = computed<Record<string, PiMotor>>(() => status.value?.motors ?? {})
  const lockedMotors = computed(() => Object.keys(motors.value).filter((m) => motors.value[m]?.locked))

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

  /** `GET /api/info` on the current address; on success loads everything and subscribes to status. */
  async function connect(url?: string): Promise<boolean> {
    if (url) setBaseUrl(url)
    connecting.value = true
    connectionError.value = null
    try {
      info.value = await client.value.info()
      connected.value = true
      lastGoodUrl.value = baseUrl.value
      await persistSettings()
      await Promise.all([refreshStatus(), refreshBundles(), refreshNet()])
      await syncClock()
      subscribe()
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
    connected.value = false
    info.value = null
    status.value = null
    bundles.value = null
    net.value = null
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
  async function guarded(action: Action): Promise<void> {
    busy.value = true
    try {
      await action()
    } catch (err) {
      if (err instanceof PiApiError && err.needsPin) {
        pendingAfterPin = action
        pinError.value = err.code === PI_CODES.pinInvalid ? piErrorMessage(err) : null
        pinDialogOpen.value = true
        return
      }
      ui.toast(piErrorMessage(err), true)
    } finally {
      busy.value = false
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

  const play = () => guarded(async () => void (status.value = await client.value.play()))
  const stop = () => guarded(async () => void (status.value = await client.value.stop()))
  const panic = () => guarded(async () => void (status.value = await client.value.panic()))
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
  const toggleOverride = (hw: PiHardware) => setOverride(hw.name, hw.off ? 'normal' : 'off')
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
        await Promise.all([refreshBundles(), refreshStatus()])
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
    init,
    setBaseUrl,
    setPin,
    forgetPin,
    connect,
    disconnect,
    refreshInfo,
    refreshStatus,
    refreshBundles,
    refreshNet,
    refreshLogs,
    guarded,
    openPinDialog,
    cancelPinDialog,
    submitPin,
    play,
    stop,
    panic,
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
  }
})
