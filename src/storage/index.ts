import type { BundleFileStore } from './bundleFiles'
import { createCapacitorBundleFiles } from './bundleFiles.capacitor'
import type { KeyValueStore } from './kv'
import { createPreferencesKv } from './kv.capacitor'
import type { LogPieceStore } from './logPieces'
import { createCapacitorLogPieces } from './logPieces.capacitor'

let kv: KeyValueStore | null = null
let files: BundleFileStore | null = null
let logPieces: LogPieceStore | null = null

/** The key-value store of the app (Capacitor Preferences unless replaced by {@link setStorage}). */
export function getKv(): KeyValueStore {
  kv ??= createPreferencesKv()
  return kv
}

/** The bundle file store of the app (Capacitor Filesystem unless replaced by {@link setStorage}). */
export function getBundleFiles(): BundleFileStore {
  files ??= createCapacitorBundleFiles()
  return files
}

/** Where the pieces of the players' log wait for Internet (Capacitor Filesystem unless replaced). */
export function getLogPieces(): LogPieceStore {
  logPieces ??= createCapacitorLogPieces()
  return logPieces
}

/** Replaces the storage backends; tests inject in-memory fakes. */
export function setStorage(overrides: { kv?: KeyValueStore; files?: BundleFileStore; logPieces?: LogPieceStore }): void {
  if (overrides.kv) kv = overrides.kv
  if (overrides.files) files = overrides.files
  if (overrides.logPieces) logPieces = overrides.logPieces
}

/** Preference keys, in one place. */
export const KEYS = {
  locale: 'ui.locale',
  session: 'auth.session',
  libraryIndex: 'library.index',
  piSettings: 'pi.settings',
  piUploads: 'pi.uploads',
  logRelay: 'logs.relay',
  devices: 'devices.index',
} as const
