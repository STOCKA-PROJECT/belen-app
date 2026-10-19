/** Shared domain types: what the Stocka backend and the Raspberry Pi API return. */

// ---------------------------------------------------------------- Stocka

export type OrganizationRole = 'OWNER' | 'MANAGER' | 'USER' | 'SPECTATOR'

export interface Organization {
  id: number
  name: string
  slug: string
  currentUserRole: OrganizationRole | null
}

export interface Timeline {
  id: number
  organizationId: number
  name: string
  createdAt: string | null
  updatedAt: string | null
}

export interface StockaUser {
  id: number
  email: string
  username?: string
  name?: string
  lastName?: string
}

export interface StockaSession {
  accessToken: string
  /** Lifetime of the access token in milliseconds, as the backend reports it. */
  expiresIn: number
  user: StockaUser
}

export type LoginResult = { kind: 'session'; session: StockaSession } | { kind: 'challenge'; mfaToken: string }

/** A finding of the show builder (`ShowIssue` in the backend). */
export interface ShowIssue {
  level: 'error' | 'warning'
  code: string
  message: string
  clipId?: string | null
  port?: string | null
}

export interface ShowMeta {
  name: string
  timelineId: number | null
  exportedAt?: string
  hash: string
}

// ---------------------------------------------------------------- Raspberry Pi

export type PiState = 'BOOT' | 'SAFE' | 'IDLE' | 'PLAYING' | 'TEST' | 'ERROR'

export interface PiHardware {
  name: string
  kind: string
  off: boolean
}

export interface PiStatus {
  state: PiState
  showHash: string | null
  showName: string | null
  board: string | null
  durationMs: number | null
  mode: { on: string; cycles: number } | null
  cycle: number
  cyclesTarget: number | null
  cycleMs: number
  overrides: string[]
  hardware: PiHardware[]
  active: string | null
  previous: string | null
  lastError: string | null
  uptimeS: number
  freeBytes: number | null
  version: string
}

export interface PiNet {
  enabled?: boolean
  mode: string
  connected: boolean
  hotspot: boolean
  ssid: string | null
  ip: string | null
  known: string[]
  available?: string[]
  backend?: string
  lastError?: string | null
}

export interface PiInfo {
  apiVersion: number
  version: string
  simulate: boolean
  device: { deviceId: string; name: string; apSsid: string; apIp: string; netMode: string }
  board: string
  catalogVersion?: number | string | null
  show: { hash: string | null; name: string | null }
  state: PiState
  net: PiNet | null
  freeBytes: number | null
  uptimeS: number
  port: number | null
}

export interface PiBundle {
  hash: string
  name: string | null
  size: number
  importedAt: string | null
  active: boolean
  previous: boolean
}

export interface PiBundles {
  active: string | null
  previous: string | null
  shows: PiBundle[]
}

export interface ImportIssue {
  level: string
  code: string
  message: string
}

/** Import report of `POST /api/bundles` and `POST /api/uploads/{id}/finish` (200 ok, 422 rejected). */
export interface ImportReport {
  ok: boolean
  hash: string | null
  name: string | null
  errors: ImportIssue[]
  warnings: ImportIssue[]
  imported: string[]
  skipped: string[]
  activateRequested?: boolean
  activated?: boolean
  bytes?: number
}

export interface PiUpload {
  uploadId: string
  name: string
  size: number
  received: number
}

export type OverrideMode = 'off' | 'normal'

// ---------------------------------------------------------------- Library

/** One downloaded bundle, as persisted in the library index. */
export interface LibraryEntry {
  fileName: string
  /** Full `sha256:<hex>` show hash (identity of the show on the Pi). */
  hash: string
  name: string
  orgSlug: string
  orgName: string
  timelineId: number
  size: number
  downloadedAt: string
}
