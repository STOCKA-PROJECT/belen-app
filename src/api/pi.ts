import type { BundleSource } from '../storage/bundleFiles'
import type { ImportReport, OverrideMode, PiAlert, PiBundles, PiClock, PiInfo, PiMotor, PiNet, PiStatus, PiUpload } from '../types'
import { joinUrl } from '../util/url'
import { isRecord, NetworkError, readJsonBody, safeFetch } from './errors'

export { NetworkError }

/** Error codes of `belen-api` v1 the app reacts to (`app/api/server.py`, `CoreError`). */
export const PI_CODES = {
  pinRequired: 'pin_required',
  pinInvalid: 'pin_invalid',
  pinLocked: 'pin_locked',
  badOffset: 'bad_offset',
  incomplete: 'incomplete',
  unknownUpload: 'unknown_upload',
  noShow: 'no_show',
  alreadyPlaying: 'already_playing',
  unknownShow: 'unknown_show',
  unknownTarget: 'unknown_target',
  invalidShow: 'invalid_show',
  rollbackFailed: 'rollback_failed',
} as const

/** `{error, message}` of the Pi API with the HTTP status; `data` keeps extras such as `received`. */
export class PiApiError extends Error {
  readonly status: number
  readonly code: string
  readonly data: Record<string, unknown>

  constructor(status: number, code: string, message: string, data: Record<string, unknown> = {}) {
    super(message || code)
    this.name = 'PiApiError'
    this.status = status
    this.code = code
    this.data = data
  }

  /** The PIN is missing or wrong: the UI must ask for it. */
  get needsPin(): boolean {
    return this.code === PI_CODES.pinRequired || this.code === PI_CODES.pinInvalid
  }

  static fromBody(status: number, body: unknown, fallback: string): PiApiError {
    const b = isRecord(body) ? body : {}
    const code = typeof b.error === 'string' ? b.error : `http_${status}`
    const message = typeof b.message === 'string' ? b.message : fallback
    return new PiApiError(status, code, message, b)
  }
}

/** The subset of `EventSource` the status subscription uses; injectable for tests. */
export interface EventSourceLike {
  onmessage: ((event: { data: string }) => void) | null
  onerror: ((event: unknown) => void) | null
  close(): void
}

export interface PiClientOptions {
  baseUrl: string
  /** Six-digit PIN sent as `Authorization: Pin <pin>` on every write; null = reads only. */
  pin?: string | null
  /** Shown by the Pi in its log next to each action (`X-Name`). */
  name?: string | null
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Resumable upload chunk; 1 MiB by default. */
  chunkSize?: number
  /** Files up to this size go in one multipart request; 4 MiB by default. */
  singleShotMax?: number
  /** Attempts per chunk before giving up; 4 by default (0.5 s, 1 s, 2 s backoff). */
  maxAttempts?: number
  eventSourceFactory?: ((url: string) => EventSourceLike) | null
}

export interface UploadOptions {
  activate?: boolean
  /** `uploadId` of a previous attempt of the same file to resume from. */
  resumeUploadId?: string | null
  /** Called as soon as an upload id exists, so the caller can persist it for a later resume. */
  onUploadId?: (uploadId: string | null) => void
  onProgress?: (sent: number, total: number) => void
  /** Called when the bytes are on the Pi and it is verifying/importing. */
  onVerifying?: () => void
  signal?: AbortSignal
}

export interface UploadResult {
  /** 200 when imported, 422 when the Pi rejected the bundle. */
  status: number
  report: ImportReport
}

const DEFAULT_CHUNK = 1024 * 1024
const DEFAULT_SINGLE_SHOT_MAX = 4 * 1024 * 1024
const DEFAULT_ATTEMPTS = 4
const DEFAULT_POLL_MS = 2000

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const defaultEventSourceFactory: ((url: string) => EventSourceLike) | null =
  typeof EventSource !== 'undefined' ? (url) => new EventSource(url) as unknown as EventSourceLike : null

/** `RequestInit` with plain-object headers plus the client's own flags. */
type RawInit = Omit<RequestInit, 'headers'> & { pin?: boolean; headers?: Record<string, string> }

/**
 * Client of the Raspberry Pi local API (`belen-api` v1). Reads need nothing; writes carry the PIN
 * header. Every method throws {@link PiApiError} for a non-2xx answer and {@link NetworkError}
 * when the Pi is unreachable.
 */
export class PiClient {
  readonly baseUrl: string
  private readonly pin: string | null
  private readonly name: string | null
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly chunkSize: number
  private readonly singleShotMax: number
  private readonly maxAttempts: number
  private readonly eventSourceFactory: ((url: string) => EventSourceLike) | null

  constructor(options: PiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.pin = options.pin ?? null
    this.name = options.name ?? null
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.sleep = options.sleep ?? defaultSleep
    this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK
    this.singleShotMax = options.singleShotMax ?? DEFAULT_SINGLE_SHOT_MAX
    this.maxAttempts = options.maxAttempts ?? DEFAULT_ATTEMPTS
    this.eventSourceFactory = options.eventSourceFactory === undefined ? defaultEventSourceFactory : options.eventSourceFactory
  }

  // ---------------------------------------------------------------- reads

  info(): Promise<PiInfo> {
    return this.json('/api/info')
  }

  status(): Promise<PiStatus> {
    return this.json('/api/status')
  }

  bundles(): Promise<PiBundles> {
    return this.json('/api/bundles')
  }

  overrides(): Promise<{ off: string[]; hardware: PiStatus['hardware'] }> {
    return this.json('/api/overrides')
  }

  async logs(n = 200): Promise<string[]> {
    const data = await this.json<{ lines?: string[] }>(`/api/logs?n=${n}`)
    return data.lines ?? []
  }

  net(): Promise<PiNet> {
    return this.json('/api/net')
  }

  /** `GET /api/alerts`: the latest alerts of the player, oldest first (empty when none). */
  async getAlerts(): Promise<PiAlert[]> {
    const data = await this.json<{ alerts?: unknown }>('/api/alerts')
    return Array.isArray(data?.alerts) ? (data.alerts.filter(isRecord) as PiAlert[]) : []
  }

  // ---------------------------------------------------------------- control (PIN)

  /**
   * `POST /api/clock`: gives the Pi this phone's time (it has no battery clock and no Internet at the
   * belén). The PIN goes along when known; the Pi only asks for it once its time is already reliable.
   */
  syncClock(epochMs: number = Date.now()): Promise<PiClock & { adjusted: boolean; offsetMs: number }> {
    return this.json('/api/clock', { method: 'POST', body: JSON.stringify({ epochMs }), pin: this.pin !== null })
  }

  play(cycles?: number): Promise<PiStatus> {
    return this.json('/api/play', { method: 'POST', body: JSON.stringify(cycles ? { cycles } : {}), pin: true })
  }

  stop(): Promise<PiStatus> {
    return this.json('/api/stop', { method: 'POST', pin: true })
  }

  panic(): Promise<PiStatus> {
    return this.json('/api/panic', { method: 'POST', pin: true })
  }

  activate(hash: string): Promise<PiStatus> {
    return this.json(`/api/bundles/${encodeURIComponent(hash)}/activate`, { method: 'POST', pin: true })
  }

  rollback(): Promise<PiStatus> {
    return this.json('/api/rollback', { method: 'POST', pin: true })
  }

  deleteBundle(hash: string): Promise<{ deleted: string }> {
    return this.json(`/api/bundles/${encodeURIComponent(hash)}`, { method: 'DELETE', pin: true })
  }

  setOverride(target: string, mode: OverrideMode): Promise<{ off: string[]; hardware: PiStatus['hardware'] }> {
    return this.json('/api/overrides', { method: 'PUT', body: JSON.stringify({ target, mode }), pin: true })
  }

  clearOverrides(): Promise<{ cleared: number; off: string[] }> {
    return this.json('/api/overrides', { method: 'DELETE', pin: true })
  }

  /** `DELETE /api/alerts`: forgets every alert; `cleared` is how many there were. */
  clearAlerts(): Promise<{ cleared: number; alerts: PiAlert[] }> {
    return this.json('/api/alerts', { method: 'DELETE', pin: true })
  }

  /**
   * `POST /api/motors/{name}/unlock`: releases a motor locked after a timeout. `unlocked` is false
   * when it was not locked; an unknown motor fails with `unknown_target`.
   */
  unlockMotor(name: string): Promise<{ motor: string; unlocked: boolean; motors: Record<string, PiMotor> }> {
    return this.json(`/api/motors/${encodeURIComponent(name)}/unlock`, { method: 'POST', pin: true })
  }

  setNetMode(mode: 'ap' | 'auto'): Promise<PiNet> {
    return this.json('/api/net/mode', { method: 'POST', body: JSON.stringify({ mode }), pin: true })
  }

  hotspotNow(): Promise<PiNet> {
    return this.json('/api/net/hotspot', { method: 'POST', pin: true })
  }

  reboot(): Promise<{ ok: boolean; message: string }> {
    return this.json('/api/system/reboot', { method: 'POST', pin: true })
  }

  // ---------------------------------------------------------------- upload

  /**
   * Sends a bundle. Small files go in one multipart `POST /api/bundles`; larger ones through the
   * resumable `/api/uploads` flow: 1 MiB chunks with `Content-Range`, a `409 bad_offset` re-syncs
   * the offset with what the Pi has, transport errors and 5xx are retried with exponential backoff,
   * and a stored `uploadId` resumes a previous attempt (after an app restart, for example).
   *
   * Returns the import report; status 422 means the Pi verified and rejected the bundle.
   */
  async uploadBundle(source: BundleSource, options: UploadOptions = {}): Promise<UploadResult> {
    if (source.size <= this.singleShotMax) return this.uploadSingle(source, options)
    return this.uploadChunked(source, options)
  }

  private async uploadSingle(source: BundleSource, options: UploadOptions): Promise<UploadResult> {
    options.onProgress?.(0, source.size)
    const bytes = await source.slice(0, source.size)
    const form = new FormData()
    form.append('file', new File([bytes as BlobPart], source.name, { type: 'application/zip' }), source.name)
    const res = await this.fetchRaw(`/api/bundles?activate=${options.activate ? '1' : '0'}`, { method: 'POST', body: form, pin: true, signal: options.signal })
    options.onProgress?.(source.size, source.size)
    options.onVerifying?.()
    return this.importResult(res)
  }

  private async uploadChunked(source: BundleSource, options: UploadOptions): Promise<UploadResult> {
    let upload = await this.resumeUpload(options.resumeUploadId ?? null, source.size)
    if (!upload) {
      upload = await this.json<PiUpload>('/api/uploads', { method: 'POST', body: JSON.stringify({ name: source.name, size: source.size }), pin: true, signal: options.signal })
    }
    options.onUploadId?.(upload.uploadId)
    let offset = upload.received
    options.onProgress?.(offset, source.size)

    while (offset < source.size) {
      throwIfAborted(options.signal)
      const end = Math.min(offset + this.chunkSize, source.size)
      const bytes = await source.slice(offset, end)
      const res = await this.withRetry(() =>
        this.fetchRaw(`/api/uploads/${encodeURIComponent(upload!.uploadId)}`, {
          method: 'PUT',
          pin: true,
          signal: options.signal,
          headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${source.size}`, 'Content-Type': 'application/octet-stream' },
          body: new File([bytes as BlobPart], 'chunk.bin', { type: 'application/octet-stream' }),
        }),
      )
      const body = await readJsonBody(res)
      if (res.status === 409 && isRecord(body) && body.error === PI_CODES.badOffset && typeof body.received === 'number') {
        offset = body.received
        options.onProgress?.(offset, source.size)
        continue
      }
      if (res.status === 404) {
        options.onUploadId?.(null)
        throw PiApiError.fromBody(res.status, body, 'Upload lost')
      }
      if (!res.ok) throw PiApiError.fromBody(res.status, body, res.statusText)
      const received = isRecord(body) && typeof body.received === 'number' ? body.received : end
      offset = received
      options.onProgress?.(offset, source.size)
    }

    options.onVerifying?.()
    const res = await this.fetchRaw(`/api/uploads/${encodeURIComponent(upload.uploadId)}/finish?activate=${options.activate ? '1' : '0'}`, { method: 'POST', pin: true, signal: options.signal })
    options.onUploadId?.(null)
    return this.importResult(res)
  }

  /** `GET /api/uploads/{id}`: the stored upload if it still exists and matches the file size. */
  private async resumeUpload(uploadId: string | null, size: number): Promise<PiUpload | null> {
    if (!uploadId) return null
    const res = await this.fetchRaw(`/api/uploads/${encodeURIComponent(uploadId)}`)
    if (!res.ok) return null
    const body = await readJsonBody(res)
    if (!isRecord(body) || body.size !== size || typeof body.received !== 'number' || typeof body.uploadId !== 'string') return null
    return body as unknown as PiUpload
  }

  private async importResult(res: Response): Promise<UploadResult> {
    const body = await readJsonBody(res)
    if (res.ok || res.status === 422) {
      const b = isRecord(body) ? body : {}
      if (typeof b.ok !== 'boolean') throw PiApiError.fromBody(res.status, body, res.statusText)
      return { status: res.status, report: toReport(b) }
    }
    throw PiApiError.fromBody(res.status, body, res.statusText)
  }

  /** Retries transport failures and 5xx answers; never retries 4xx (PIN, offset, not found). */
  private async withRetry(fn: () => Promise<Response>): Promise<Response> {
    let delay = 500
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fn()
        if (res.status >= 500 && attempt < this.maxAttempts) {
          await this.sleep(delay)
          delay *= 2
          continue
        }
        return res
      } catch (err) {
        if (!(err instanceof NetworkError) || err.aborted || attempt >= this.maxAttempts) throw err
        await this.sleep(delay)
        delay *= 2
      }
    }
  }

  // ---------------------------------------------------------------- live status

  /**
   * Pushes every status snapshot: through `GET /api/events` (SSE) when the environment allows it,
   * and otherwise (or as soon as the stream fails) by polling `GET /api/status`. Returns the
   * unsubscribe function.
   */
  subscribeStatus(onStatus: (status: PiStatus) => void, options: { onError?: (err: unknown) => void; pollMs?: number; sse?: boolean } = {}): () => void {
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS
    let stopped = false
    let source: EventSourceLike | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let polling = false

    const poll = async () => {
      if (stopped) return
      try {
        onStatus(await this.status())
      } catch (err) {
        options.onError?.(err)
      }
      if (!stopped) timer = setTimeout(() => void poll(), pollMs)
    }
    const startPolling = () => {
      if (stopped || polling) return
      polling = true
      void poll()
    }

    if (options.sse !== false && this.eventSourceFactory) {
      try {
        source = this.eventSourceFactory(joinUrl(this.baseUrl, '/api/events'))
      } catch {
        source = null
      }
    }
    if (source) {
      const es = source
      es.onmessage = (event) => {
        try {
          onStatus(JSON.parse(event.data) as PiStatus)
        } catch {
          /* ignore malformed frames */
        }
      }
      es.onerror = () => {
        es.close()
        source = null
        startPolling()
      }
    } else {
      startPolling()
    }

    return () => {
      stopped = true
      source?.close()
      if (timer) clearTimeout(timer)
    }
  }

  // ---------------------------------------------------------------- plumbing

  private async fetchRaw(path: string, init: RawInit = {}): Promise<Response> {
    const { pin = false, headers = {}, ...rest } = init
    const merged: Record<string, string> = { Accept: 'application/json', ...headers }
    if (pin) {
      if (!this.pin) throw new PiApiError(401, PI_CODES.pinRequired, 'PIN required')
      merged.Authorization = `Pin ${this.pin}`
      if (this.name) merged['X-Name'] = this.name
    }
    if (typeof rest.body === 'string' && !merged['Content-Type']) merged['Content-Type'] = 'application/json'
    return safeFetch(this.fetchImpl, joinUrl(this.baseUrl, path), { ...rest, headers: merged })
  }

  private async json<T>(path: string, init: RawInit = {}): Promise<T> {
    const res = await this.fetchRaw(path, init)
    const body = await readJsonBody(res)
    if (!res.ok) throw PiApiError.fromBody(res.status, body, res.statusText)
    return body as T
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new NetworkError('aborted', true)
}

function toReport(b: Record<string, unknown>): ImportReport {
  const issues = (value: unknown) =>
    Array.isArray(value)
      ? value.filter(isRecord).map((i) => ({ level: String(i.level ?? 'error'), code: String(i.code ?? ''), message: String(i.message ?? '') }))
      : []
  const strings = (value: unknown) => (Array.isArray(value) ? value.map(String) : [])
  return {
    ok: b.ok === true,
    hash: typeof b.hash === 'string' ? b.hash : null,
    name: typeof b.name === 'string' ? b.name : null,
    errors: issues(b.errors),
    warnings: issues(b.warnings),
    imported: strings(b.imported),
    skipped: strings(b.skipped),
    activateRequested: b.activateRequested === true,
    activated: b.activated === true,
    bytes: typeof b.bytes === 'number' ? b.bytes : undefined,
  }
}
