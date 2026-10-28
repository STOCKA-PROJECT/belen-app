import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { NetworkError } from '../api/errors'
import type { PiClient } from '../api/pi'
import { StockaApiError, type StockaClient } from '../api/stocka'
import { getKv, getLogPieces, KEYS } from '../storage'
import { readJson, writeJson } from '../storage/kv'

/** Bytes read from the Pi at a time; each becomes one piece on the phone and one upload. */
export const LOG_PIECE_BYTES = 512 * 1024
/** The phone keeps at most this much log waiting for Internet; reading stops when it is full. */
export const MAX_QUEUED_BYTES = 40 * 1024 * 1024
/** At most this much is read from the Pi per round, so a connection is never busy for long. */
export const MAX_READ_PER_ROUND = 8 * 1024 * 1024
/** Days of log worth reading from a Pi the app knows nothing about yet (Stocka keeps 180). */
export const FIRST_READ_DAYS = 30

/** A piece of a player's log waiting on the phone: bytes `[from, to)` of `file`. */
export interface QueuedLogPiece {
  id: string
  device: string
  file: string
  from: number
  to: number
}

/** What the app knows of one player's log. */
interface DeviceProgress {
  /** How far the app has read each file from the Pi. */
  read: Record<string, number>
  /** How far Stocka had each file the last time the app asked. */
  stored: Record<string, number>
  /** Oldest day Stocka keeps (`YYYY-MM-DD`), once known. */
  since: string | null
  /** Stocka does not know this player yet (no heartbeat, never seen by the editor). */
  unknown?: boolean
}

interface RelayIndex {
  pieces: QueuedLogPiece[]
  devices: Record<string, DeviceProgress>
  lastUploadAt: string | null
}

const DAY_IN_NAME = /(\d{4}-\d{2}-\d{2})/

function emptyIndex(): RelayIndex {
  return { pieces: [], devices: {}, lastUploadAt: null }
}

function dayOf(name: string): string | null {
  return DAY_IN_NAME.exec(name)?.[1] ?? null
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function pieceId(device: string, file: string, from: number): string {
  return `${device}_${file.replace(/[^A-Za-z0-9._-]/g, '_')}_${from}`
}

/**
 * The app carries the players' log to Stocka. At the belén the Pi has no Internet and the phone is
 * on the Pi's Wi-Fi: {@link collect} reads what is new from the Pi (`GET /api/logs/files`) and keeps
 * it on the phone; once the phone has Internet and a Stocka session, {@link flush} asks Stocka how
 * far each file is stored (the Pi may have uploaded part itself) and sends the rest. Stocka drops
 * whatever it already has, so a piece sent twice is harmless.
 */
export const useLogRelayStore = defineStore('logRelay', () => {
  const index = ref<RelayIndex>(emptyIndex())
  const collecting = ref(false)
  const flushing = ref(false)
  const lastError = ref<string | null>(null)
  let loaded = false

  const pendingBytes = computed(() => index.value.pieces.reduce((n, p) => n + (p.to - p.from), 0))
  const pendingPieces = computed(() => index.value.pieces.length)
  const lastUploadAt = computed(() => index.value.lastUploadAt)
  /** Some waiting log belongs to a player Stocka does not know yet. */
  const waitingForUnknownDevice = computed(() => index.value.pieces.some((p) => index.value.devices[p.device]?.unknown))
  const full = computed(() => pendingBytes.value >= MAX_QUEUED_BYTES)

  async function init(): Promise<void> {
    if (loaded) return
    const saved = await readJson<RelayIndex>(getKv(), KEYS.logRelay)
    index.value = saved && Array.isArray(saved.pieces) && typeof saved.devices === 'object' ? { ...emptyIndex(), ...saved } : emptyIndex()
    loaded = true
  }

  async function persist(): Promise<void> {
    await writeJson(getKv(), KEYS.logRelay, index.value)
  }

  function progressOf(device: string): DeviceProgress {
    index.value.devices[device] ??= { read: {}, stored: {}, since: null }
    return index.value.devices[device]!
  }

  async function dropPiece(piece: QueuedLogPiece): Promise<void> {
    await getLogPieces().remove(piece.id)
    index.value.pieces = index.value.pieces.filter((p) => p.id !== piece.id)
  }

  /**
   * Reads from the Pi the log the phone and Stocka do not have yet and keeps it on the phone.
   * Never throws: a Pi without the endpoint (older version) or a dropped connection just stops.
   *
   * @param pi     client of the connected Pi
   * @param device uuid the Pi generates for itself (`info.device.deviceId`)
   * @returns bytes queued
   */
  async function collect(pi: PiClient, device: string): Promise<number> {
    if (collecting.value || !device) return 0
    collecting.value = true
    await init()
    let queued = 0
    try {
      const files = await pi.logFiles()
      const progress = progressOf(device)
      const cutoff = progress.since ?? isoDay(new Date(Date.now() - FIRST_READ_DAYS * 86_400_000))
      let budget = Math.min(MAX_READ_PER_ROUND, MAX_QUEUED_BYTES - pendingBytes.value)
      for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
        const day = dayOf(file.name)
        if (day !== null && day < cutoff) continue
        let start = Math.max(progress.read[file.name] ?? 0, progress.stored[file.name] ?? 0)
        if (start > file.size) continue // shorter than what is known: rotated, nothing sensible to do
        while (start < file.size && budget > 0) {
          const piece = await pi.logPiece(file.name, start, Math.min(LOG_PIECE_BYTES, budget))
          if (piece.bytes.byteLength === 0) break // a half-written line: next time
          const id = pieceId(device, file.name, start)
          await getLogPieces().write(id, piece.bytes)
          const end = start + piece.bytes.byteLength
          index.value.pieces.push({ id, device, file: file.name, from: start, to: end })
          progress.read[file.name] = end
          budget -= piece.bytes.byteLength
          queued += piece.bytes.byteLength
          start = end
          await persist()
        }
        if (budget <= 0) break
      }
    } catch {
      // older player without /api/logs/files, or the Wi-Fi dropped: keep what was read
    } finally {
      collecting.value = false
      await persist()
    }
    return queued
  }

  /**
   * Sends the waiting log to Stocka. Stops at the first network or session problem and keeps the
   * rest for later; a player Stocka does not know yet keeps its log until it does.
   *
   * @param stocka client with the user's session
   * @returns bytes Stocka stored that it did not have
   */
  async function flush(stocka: StockaClient): Promise<number> {
    await init()
    if (flushing.value || index.value.pieces.length === 0) return 0
    flushing.value = true
    let uploaded = 0
    try {
      const devices = [...new Set(index.value.pieces.map((p) => p.device))]
      for (const device of devices) {
        const progress = progressOf(device)
        try {
          const cursor = await stocka.logCursor(device)
          progress.stored = cursor.files
          progress.since = cursor.since
          progress.unknown = false
        } catch (err) {
          if (err instanceof StockaApiError && err.status === 404) {
            progress.unknown = true
            continue
          }
          throw err
        }
        const pieces = index.value.pieces
          .filter((p) => p.device === device)
          .sort((a, b) => a.file.localeCompare(b.file) || a.from - b.from)
        for (const piece of pieces) {
          if (!index.value.pieces.some((p) => p.id === piece.id)) continue // dropped with its file after a gap
          const end = progress.stored[piece.file] ?? 0
          if (piece.to <= end) {
            await dropPiece(piece) // Stocka has it already (the Pi uploaded it, or an earlier try)
            continue
          }
          if (piece.from > end) {
            await forgetFile(device, piece.file, end)
            continue
          }
          let bytes: Uint8Array
          try {
            bytes = await getLogPieces().read(piece.id)
          } catch {
            // The piece file is gone from the phone (storage cleaned, reinstall): it is a gap now.
            await forgetFile(device, piece.file, end)
            continue
          }
          try {
            const result = await stocka.uploadLog(device, piece.file, piece.from, bytes)
            progress.stored[piece.file] = result.end
            uploaded += result.stored
            if (result.stored > 0) index.value.lastUploadAt = new Date().toISOString()
            await dropPiece(piece)
          } catch (err) {
            const expected = err instanceof StockaApiError && err.status === 409 ? Number(err.params.expected) : NaN
            if (!Number.isFinite(expected)) throw err
            progress.stored[piece.file] = expected
            if (piece.to <= expected) await dropPiece(piece)
            else await forgetFile(device, piece.file, expected)
          }
          await persist()
        }
      }
      lastError.value = null
    } catch (err) {
      lastError.value = err instanceof NetworkError ? 'network' : err instanceof StockaApiError ? err.code : String(err)
    } finally {
      flushing.value = false
      await persist()
    }
    return uploaded
  }

  /**
   * Stocka lacks bytes before the waiting pieces of a file (they were read from a later point): the
   * pieces go and the file is read again from where Stocka stops, next time the phone sees the Pi.
   */
  async function forgetFile(device: string, file: string, from: number): Promise<void> {
    for (const piece of index.value.pieces.filter((p) => p.device === device && p.file === file)) await dropPiece(piece)
    progressOf(device).read[file] = from
  }

  return {
    index,
    collecting,
    flushing,
    lastError,
    pendingBytes,
    pendingPieces,
    lastUploadAt,
    waitingForUnknownDevice,
    full,
    init,
    collect,
    flush,
  }
})
