import type { ByteSink } from '../storage/bundleFiles'
import type { LoginResult, Organization, ShowIssue, ShowMeta, StockaSession, Timeline } from '../types'
import { parseContentDispositionFilename } from '../util/bundleName'
import { joinUrl } from '../util/url'
import { isRecord, NetworkError, readJsonBody, safeFetch } from './errors'

export { NetworkError }

/** Error codes of the backend the app reacts to (`ErrorCodes.java`). */
export const STOCKA_CODES = {
  invalidCredentials: 'auth.invalid_credentials',
  tokenExpired: 'auth.token_expired',
  unauthenticated: 'auth.unauthenticated',
  twoFactorInvalidCode: 'auth.2fa_invalid_code',
  twoFactorTokenExpired: 'auth.2fa_mfa_token_expired',
  emailNotVerified: 'auth.email_not_verified',
  showInvalid: 'timeline_shows.invalid',
  showSceneNotFound: 'timeline_shows.scene_not_found',
  showAssetNotFound: 'timeline_shows.asset_not_found',
} as const

/**
 * An HTTP error of the Stocka API, parsed from its RFC 7807 body
 * (`{type, title, status, detail, code, params, errors}`). For `timeline_shows.invalid` (422) the
 * blocking findings come in `params.issues` and the non-blocking ones in `params.warnings`.
 */
export class StockaApiError extends Error {
  readonly status: number
  readonly code: string
  readonly detail: string
  readonly params: Record<string, unknown>
  readonly issues: ShowIssue[]
  readonly warnings: ShowIssue[]

  constructor(status: number, code: string, detail: string, params: Record<string, unknown> = {}, issues: ShowIssue[] = [], warnings: ShowIssue[] = []) {
    super(detail || code)
    this.name = 'StockaApiError'
    this.status = status
    this.code = code
    this.detail = detail
    this.params = params
    this.issues = issues
    this.warnings = warnings
  }

  /** Whether the session must be renewed (token expired, revoked or missing). */
  get isAuthError(): boolean {
    return this.status === 401 && this.code !== STOCKA_CODES.invalidCredentials && this.code !== STOCKA_CODES.twoFactorInvalidCode
  }
}

function toIssue(value: unknown): ShowIssue | null {
  if (!isRecord(value) || typeof value.code !== 'string') return null
  return {
    level: value.level === 'warning' ? 'warning' : 'error',
    code: value.code,
    message: typeof value.message === 'string' ? value.message : value.code,
    clipId: typeof value.clipId === 'string' ? value.clipId : null,
    port: typeof value.port === 'string' ? value.port : null,
  }
}

function toIssues(value: unknown): ShowIssue[] {
  return Array.isArray(value) ? value.map(toIssue).filter((i): i is ShowIssue => i !== null) : []
}

/** Builds a {@link StockaApiError} from a non-2xx response. */
export async function stockaErrorFrom(res: Response): Promise<StockaApiError> {
  const body = await readJsonBody(res)
  const b = isRecord(body) ? body : {}
  const code = typeof b.code === 'string' ? b.code : `http.${res.status}`
  const detail = typeof b.detail === 'string' ? b.detail : typeof b.message === 'string' ? b.message : res.statusText || `HTTP ${res.status}`
  const params = isRecord(b.params) ? b.params : {}
  return new StockaApiError(res.status, code, detail, params, toIssues(params.issues ?? b.issues), toIssues(params.warnings))
}

/** `RequestInit` with plain-object headers plus the client's own flags. */
type ReqInit = Omit<RequestInit, 'headers'> & { auth?: boolean; headers?: Record<string, string> }

export interface StockaClientOptions {
  baseUrl: string
  /** Current access token, or null when logged out. */
  getToken?: () => string | null
  /** `Accept-Language` for the error texts of the backend. */
  getLocale?: () => string
  fetchImpl?: typeof fetch
}

export interface DownloadOptions {
  onProgress?: (received: number, total: number | null) => void
  signal?: AbortSignal
}

export interface DownloadResult {
  bytes: number
  /** File name announced by the backend, when the header was readable. */
  fileName: string | null
}

/**
 * Client of the Stocka REST API (JWT bearer). Every method throws {@link StockaApiError} on a non-2xx
 * answer and {@link NetworkError} when the backend cannot be reached (offline).
 */
export class StockaClient {
  private readonly baseUrl: string
  private readonly getToken: () => string | null
  private readonly getLocale: () => string
  private readonly fetchImpl: typeof fetch

  constructor(options: StockaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.getToken = options.getToken ?? (() => null)
    this.getLocale = options.getLocale ?? (() => 'ca')
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
  }

  // ---------------------------------------------------------------- auth

  /** `POST /auth/login`: a session, or a 2FA challenge the caller completes with {@link loginTwoFactor}. */
  async login(email: string, password: string): Promise<LoginResult> {
    const body = await this.json<Record<string, unknown>>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, rememberMe: false }),
      auth: false,
    })
    if (body.requires2fa === true && typeof body.mfaToken === 'string') return { kind: 'challenge', mfaToken: body.mfaToken }
    return { kind: 'session', session: toSession(body) }
  }

  /** `POST /auth/login/2fa` with the TOTP or recovery code. */
  async loginTwoFactor(mfaToken: string, code: string): Promise<StockaSession> {
    const body = await this.json<Record<string, unknown>>('/auth/login/2fa', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code, rememberMe: false }),
      auth: false,
    })
    return toSession(body)
  }

  /** `POST /auth/logout`, best effort: the server revokes the token family. */
  async logout(): Promise<void> {
    try {
      await this.json('/auth/logout', { method: 'POST' })
    } catch {
      /* the local session is dropped regardless */
    }
  }

  // ---------------------------------------------------------------- catalogue

  async listOrganizations(): Promise<Organization[]> {
    const list = await this.json<unknown[]>('/organizations')
    return list.map((o) => {
      const r = isRecord(o) ? o : {}
      return {
        id: Number(r.id),
        name: String(r.name ?? ''),
        slug: String(r.slug ?? ''),
        currentUserRole: typeof r.currentUserRole === 'string' ? (r.currentUserRole as Organization['currentUserRole']) : null,
      }
    })
  }

  async listTimelines(orgSlug: string): Promise<Timeline[]> {
    const list = await this.json<unknown[]>(`/organizations/${encodeURIComponent(orgSlug)}/timelines`)
    return list.map((t) => {
      const r = isRecord(t) ? t : {}
      return {
        id: Number(r.id),
        organizationId: Number(r.organizationId),
        name: String(r.name ?? ''),
        createdAt: typeof r.createdAt === 'string' ? r.createdAt : null,
        updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : null,
      }
    })
  }

  /** `GET …/show`: only the `meta` block (name and hash) is needed to name and index the bundle. */
  async getShowMeta(orgSlug: string, timelineId: number): Promise<ShowMeta> {
    const body = await this.json<Record<string, unknown>>(`/organizations/${encodeURIComponent(orgSlug)}/timelines/${timelineId}/show`)
    const meta = isRecord(body.meta) ? body.meta : {}
    if (typeof meta.hash !== 'string') throw new StockaApiError(502, 'show.meta_missing', 'Show without meta.hash')
    return {
      name: typeof meta.name === 'string' ? meta.name : '',
      timelineId: typeof meta.timelineId === 'number' ? meta.timelineId : timelineId,
      exportedAt: typeof meta.exportedAt === 'string' ? meta.exportedAt : undefined,
      hash: meta.hash,
    }
  }

  /**
   * `GET …/bundle`, streamed into `sink` chunk by chunk so a 50 MB bundle never sits in memory. The
   * caller closes or aborts the sink.
   */
  async downloadBundle(orgSlug: string, timelineId: number, sink: ByteSink, options: DownloadOptions = {}): Promise<DownloadResult> {
    const res = await this.request(`/organizations/${encodeURIComponent(orgSlug)}/timelines/${timelineId}/bundle`, {
      headers: { Accept: 'application/zip, application/problem+json;q=0.9, application/json;q=0.8' },
      signal: options.signal,
    })
    if (!res.ok) throw await stockaErrorFrom(res)
    const lengthHeader = res.headers.get('content-length')
    const total = lengthHeader && Number(lengthHeader) > 0 ? Number(lengthHeader) : null
    const fileName = parseContentDispositionFilename(res.headers.get('content-disposition'))
    let received = 0
    if (res.body) {
      const reader = res.body.getReader()
      for (;;) {
        let step: ReadableStreamReadResult<Uint8Array>
        try {
          step = await reader.read()
        } catch (err) {
          throw new NetworkError(err instanceof Error ? err.message : String(err))
        }
        if (step.done) break
        await sink.write(step.value)
        received += step.value.byteLength
        options.onProgress?.(received, total)
      }
    } else {
      const bytes = new Uint8Array(await res.arrayBuffer())
      await sink.write(bytes)
      received = bytes.byteLength
      options.onProgress?.(received, total)
    }
    return { bytes: received, fileName }
  }

  // ---------------------------------------------------------------- plumbing

  private headers(extra: Record<string, string> = {}, auth = true): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json, application/problem+json',
      'Accept-Language': this.getLocale(),
      ...extra,
    }
    const token = auth ? this.getToken() : null
    if (token) headers.Authorization = `Bearer ${token}`
    return headers
  }

  private async request(path: string, init: ReqInit = {}): Promise<Response> {
    const { auth = true, headers, ...rest } = init
    const merged = this.headers(headers, auth)
    if (rest.body !== undefined && !merged['Content-Type']) merged['Content-Type'] = 'application/json'
    return safeFetch(this.fetchImpl, joinUrl(this.baseUrl, path), { ...rest, headers: merged })
  }

  private async json<T>(path: string, init: ReqInit = {}): Promise<T> {
    const res = await this.request(path, init)
    if (!res.ok) throw await stockaErrorFrom(res)
    if (res.status === 204) return undefined as T
    return (await readJsonBody(res)) as T
  }
}

function toSession(body: Record<string, unknown>): StockaSession {
  if (typeof body.accessToken !== 'string') throw new StockaApiError(502, 'auth.malformed_response', 'Login response without accessToken')
  const user = isRecord(body.user) ? body.user : {}
  return {
    accessToken: body.accessToken,
    expiresIn: typeof body.expiresIn === 'number' ? body.expiresIn : 15 * 60 * 1000,
    user: {
      id: Number(user.id ?? 0),
      email: String(user.email ?? ''),
      username: typeof user.username === 'string' ? user.username : undefined,
      name: typeof user.name === 'string' ? user.name : undefined,
      lastName: typeof user.lastName === 'string' ? user.lastName : undefined,
    },
  }
}
