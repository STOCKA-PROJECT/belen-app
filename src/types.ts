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

/** What the player does when a sensor becomes active (`onActive` of a `sensor` port). */
export type SensorOnActive = 'none' | 'play' | 'stop_show' | 'panic'

/** Live reading of a `sensor` port (`status.sensors[name]`, `InputController.snapshot`). */
export interface PiSensor {
  /** Debounced logical state (active level already applied). */
  active: boolean
  /** Raw pin level, null when it could not be read. */
  raw: boolean | null
  onActive: SensorOnActive
  /** Cut by an override: the sensor is ignored. Panic sensors are never blocked. */
  blocked: boolean
  /** Human-readable input, e.g. `GPIO 20`, `exp1:15` or `vl53l0x I2C 1:0x29`. */
  address: string
  /** Measured sensors only (`source: measured`): last value (null = no reading), its unit and the threshold. */
  value?: number | null
  unit?: string | null
  quantity?: string | null
  threshold?: number
  activeWhen?: 'above' | 'below'
}

export type MotorDirection = 'forward' | 'reverse'

/** Why the last run of a motor ended. */
export type MotorEnd = 'time' | 'limit' | 'max_time' | 'stop' | 'blocked' | 'locked'

/** Live state of a `motor` port (`status.motors[name]`, `MotorController.status`). */
export interface PiMotor {
  /** Direction it is turning now; null when stopped. */
  direction: MotorDirection | null
  /** Seconds of the current run; 0 when stopped. */
  runningS: number
  lastEnd: MotorEnd | null
  /** Locked after a `max_time` timeout (with `lockOnTimeout`): it ignores the show until unlocked. */
  locked: boolean
  /** Cut by an override. */
  blocked: boolean
  limitForward: string | null
  limitReverse: string | null
}

/** Alert codes the player raises today; others may appear and must be shown with a fallback. */
export const PI_ALERT_CODES = ['motor_timeout', 'sensor_stop_show', 'sensor_panic'] as const
export type PiAlertCode = (typeof PI_ALERT_CODES)[number]

/** One entry of `status.alerts` / `GET /api/alerts` (the player keeps the last 50). */
export interface PiAlert {
  code: string
  port: string | null
  /** Already in Catalan; shown as-is. */
  message: string
  /** ISO 8601 timestamp (UTC). */
  at: string
  /** `motor_timeout`: direction that timed out. */
  direction?: MotorDirection
  /** `motor_timeout`: whether the motor got locked. */
  locked?: boolean
  [extra: string]: unknown
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
  /** Sensor ports by name (absent on players older than contract v3). */
  sensors?: Record<string, PiSensor>
  /** Motor ports by name (absent on players older than contract v3). */
  motors?: Record<string, PiMotor>
  /** Latest alerts, oldest first (absent on players older than contract v3). */
  alerts?: PiAlert[]
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
