import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { NetworkError } from '../api/errors'
import type { PiClient, PiLogFile, PiLogPiece } from '../api/pi'
import { StockaApiError, type LogAppendResult, type LogCursor, type StockaClient } from '../api/stocka'
import { KEYS, setStorage } from '../storage'
import { createMemoryBundleFiles } from '../storage/bundleFiles'
import { createMemoryKv } from '../storage/kv'
import { createMemoryLogPieces } from '../storage/logPieces'
import { FIRST_READ_DAYS, LOG_PIECE_BYTES, MAX_QUEUED_BYTES, useLogRelayStore } from './logRelay'

const UUID = '6f1c2a9e-4b7d-4e21-9c3a-0d5e8f7b1a42'
const enc = new TextEncoder()
const dec = new TextDecoder()

function today(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

/** A Pi with log files whose content can grow; reads stop at the last full line like the real one. */
function fakePi(initial: Record<string, string>) {
  const files = new Map(Object.entries(initial).map(([name, text]) => [name, enc.encode(text)]))
  const reads: Array<{ name: string; from: number; max: number }> = []
  const pi = {
    async logFiles(): Promise<PiLogFile[]> {
      return [...files].map(([name, bytes]) => ({ name, size: bytes.byteLength }))
    },
    async logPiece(name: string, from: number, max: number): Promise<PiLogPiece> {
      reads.push({ name, from, max })
      const all = files.get(name)!
      const window = all.subarray(from, from + max)
      const cut = window.lastIndexOf(10)
      const bytes = cut >= 0 ? window.subarray(0, cut + 1) : window.byteLength === max ? window : new Uint8Array(0)
      return { bytes, from, to: from + bytes.byteLength, size: all.byteLength }
    },
  }
  return {
    pi: pi as unknown as PiClient,
    reads,
    append(name: string, text: string) {
      const old = files.get(name) ?? new Uint8Array(0)
      const next = new Uint8Array(old.byteLength + enc.encode(text).byteLength)
      next.set(old)
      next.set(enc.encode(text), old.byteLength)
      files.set(name, next)
    },
  }
}

/** Stocka as the backend behaves: cursor per file, trims what it has, 409 when a piece leaves a gap. */
function fakeStocka(options: { known?: boolean; since?: string | null } = {}) {
  const stored = new Map<string, Uint8Array>()
  const uploads: Array<{ file: string; from: number; bytes: number }> = []
  let failure: Error | null = null
  const stocka = {
    async logCursor(device: string): Promise<LogCursor> {
      if (failure) throw failure
      if (device !== UUID || options.known === false) throw new StockaApiError(404, 'devices.not_found', 'Dispositiu no trobat.')
      return { files: Object.fromEntries([...stored].map(([k, v]) => [k, v.byteLength])), since: options.since ?? null }
    },
    async uploadLog(_device: string, file: string, from: number, bytes: Uint8Array): Promise<LogAppendResult> {
      if (failure) throw failure
      const have = stored.get(file) ?? new Uint8Array(0)
      if (from > have.byteLength) throw new StockaApiError(409, 'devices.log_offset_mismatch', 'gap', { expected: have.byteLength })
      uploads.push({ file, from, bytes: bytes.byteLength })
      const fresh = from + bytes.byteLength > have.byteLength ? bytes.subarray(have.byteLength - from) : new Uint8Array(0)
      const next = new Uint8Array(have.byteLength + fresh.byteLength)
      next.set(have)
      next.set(fresh, have.byteLength)
      stored.set(file, next)
      return { file, end: next.byteLength, stored: fresh.byteLength }
    },
  }
  return {
    stocka: stocka as unknown as StockaClient,
    stored,
    uploads,
    text: (file: string) => dec.decode(stored.get(file) ?? new Uint8Array(0)),
    fail: (err: Error | null) => void (failure = err),
  }
}

describe('logRelay store', () => {
  let kv: ReturnType<typeof createMemoryKv>
  let pieces: ReturnType<typeof createMemoryLogPieces>
  const FILE = `system-${today()}.log`

  beforeEach(() => {
    kv = createMemoryKv()
    pieces = createMemoryLogPieces()
    setStorage({ kv, files: createMemoryBundleFiles(), logPieces: pieces })
    setActivePinia(createPinia())
  })

  describe('collect', () => {
    it('reads every recent file from the start and keeps it on the phone', async () => {
      const { pi } = fakePi({ [FILE]: 'a1\na2\n', [`system-${today(-1)}.log`]: 'b1\n' })
      const relay = useLogRelayStore()

      expect(await relay.collect(pi, UUID)).toBe(9)

      expect(relay.pendingBytes).toBe(9)
      expect(relay.index.pieces.map((p) => [p.file, p.from, p.to])).toEqual([[`system-${today(-1)}.log`, 0, 3], [FILE, 0, 6]])
      expect(pieces.pieces.size).toBe(2)
    })

    it('reads only what is new the next time', async () => {
      const fake = fakePi({ [FILE]: 'a1\n' })
      const relay = useLogRelayStore()
      await relay.collect(fake.pi, UUID)
      fake.append(FILE, 'a2\n')

      expect(await relay.collect(fake.pi, UUID)).toBe(3)

      expect(relay.index.pieces.at(-1)).toMatchObject({ from: 3, to: 6 })
      expect(await relay.collect(fake.pi, UUID)).toBe(0)
    })

    it('leaves a half-written line for later', async () => {
      const fake = fakePi({ [FILE]: 'a1\na2 a mig' })
      const relay = useLogRelayStore()

      expect(await relay.collect(fake.pi, UUID)).toBe(3)
      fake.append(FILE, ' acabada\n')
      await relay.collect(fake.pi, UUID)

      expect(relay.index.pieces.at(-1)).toMatchObject({ from: 3 })
      expect(relay.pendingBytes).toBe(enc.encode('a1\na2 a mig acabada\n').byteLength)
    })

    it(`skips files older than ${FIRST_READ_DAYS} days while Stocka's retention is unknown, and older than it once known`, async () => {
      const old = `system-${today(-(FIRST_READ_DAYS + 1))}.log`
      const fake = fakePi({ [old]: 'vell\n', [FILE]: 'nou\n', 'player.log': 'sense data\n' })
      const relay = useLogRelayStore()

      await relay.collect(fake.pi, UUID)
      expect(relay.index.pieces.map((p) => p.file).sort()).toEqual([FILE, 'player.log'].sort())

      relay.index.devices[UUID]!.since = today(-(FIRST_READ_DAYS + 5))
      await relay.collect(fake.pi, UUID)
      expect(relay.index.pieces.map((p) => p.file)).toContain(old)
    })

    it('starts from what Stocka already has, so the log the Pi uploaded itself is not read again', async () => {
      const fake = fakePi({ [FILE]: 'a1\na2\n' })
      const { stocka, stored } = fakeStocka()
      stored.set(FILE, enc.encode('a1\n'))
      const relay = useLogRelayStore()
      await relay.init()
      relay.index.devices[UUID] = { read: {}, stored: { [FILE]: 3 }, since: null }

      await relay.collect(fake.pi, UUID)

      expect(fake.reads[0]).toMatchObject({ from: 3 })
      await relay.flush(stocka)
      expect(dec.decode(stored.get(FILE))).toBe('a1\na2\n')
    })

    it('reads pieces of at most LOG_PIECE_BYTES', async () => {
      const line = 'x'.repeat(1023) + '\n'
      const fake = fakePi({ [FILE]: line.repeat(LOG_PIECE_BYTES / 1024 + 10) })
      const relay = useLogRelayStore()

      await relay.collect(fake.pi, UUID)

      expect(fake.reads.every((r) => r.max <= LOG_PIECE_BYTES)).toBe(true)
      expect(relay.index.pieces).toHaveLength(2)
    })

    it('stops reading once the phone holds the maximum', async () => {
      const fake = fakePi({ [FILE]: 'a1\na2\na3\n' })
      const relay = useLogRelayStore()
      await relay.init()
      relay.index.pieces.push({ id: 'other', device: 'x', file: 'x.log', from: 0, to: MAX_QUEUED_BYTES - 4 })

      await relay.collect(fake.pi, UUID)

      expect(fake.reads[0]!.max).toBe(4)
      expect(relay.pendingBytes).toBe(MAX_QUEUED_BYTES)
      expect(relay.full).toBe(true)
      expect(await relay.collect(fake.pi, UUID)).toBe(0)
    })

    it('does nothing with a Pi without the log endpoint or an empty uuid', async () => {
      const pi = { logFiles: async () => { throw new Error('404') } } as unknown as PiClient
      const relay = useLogRelayStore()

      expect(await relay.collect(pi, UUID)).toBe(0)
      expect(await relay.collect(fakePi({ [FILE]: 'a\n' }).pi, '')).toBe(0)
      expect(relay.pendingPieces).toBe(0)
    })
  })

  describe('flush', () => {
    it('sends the waiting log in order, empties the phone and remembers when', async () => {
      const fake = fakePi({ [FILE]: 'a1\na2\n', [`system-${today(-1)}.log`]: 'b1\n' })
      const { stocka, text } = fakeStocka()
      const relay = useLogRelayStore()
      await relay.collect(fake.pi, UUID)

      expect(await relay.flush(stocka)).toBe(9)

      expect(text(FILE)).toBe('a1\na2\n')
      expect(relay.pendingBytes).toBe(0)
      expect(pieces.pieces.size).toBe(0)
      expect(relay.lastUploadAt).not.toBeNull()
      expect(relay.lastError).toBeNull()
    })

    it('drops pieces Stocka already has without sending them, and trims a partial overlap', async () => {
      const fake = fakePi({ [FILE]: 'a1\na2\n' })
      const { stocka, stored, uploads, text } = fakeStocka()
      const relay = useLogRelayStore()
      await relay.collect(fake.pi, UUID)
      stored.set(FILE, enc.encode('a1\n')) // the Pi uploaded part of it meanwhile

      expect(await relay.flush(stocka)).toBe(3)

      expect(uploads).toEqual([{ file: FILE, from: 0, bytes: 6 }])
      expect(text(FILE)).toBe('a1\na2\n')

      fake.append(FILE, 'a3\n')
      await relay.collect(fake.pi, UUID)
      stored.set(FILE, enc.encode('a1\na2\na3\n'))
      expect(await relay.flush(stocka)).toBe(0)
      expect(uploads).toHaveLength(1)
      expect(relay.pendingPieces).toBe(0)
    })

    it('keeps the log of a player Stocka does not know yet', async () => {
      const fake = fakePi({ [FILE]: 'a1\n' })
      const { stocka } = fakeStocka({ known: false })
      const relay = useLogRelayStore()
      await relay.collect(fake.pi, UUID)

      expect(await relay.flush(stocka)).toBe(0)

      expect(relay.pendingPieces).toBe(1)
      expect(relay.waitingForUnknownDevice).toBe(true)
    })

    it('keeps everything and says so when there is no network', async () => {
      const fake = fakePi({ [FILE]: 'a1\n' })
      const { stocka, fail } = fakeStocka()
      const relay = useLogRelayStore()
      await relay.collect(fake.pi, UUID)
      fail(new NetworkError('offline'))

      expect(await relay.flush(stocka)).toBe(0)

      expect(relay.pendingPieces).toBe(1)
      expect(relay.lastError).toBe('network')
      fail(null)
      expect(await relay.flush(stocka)).toBe(3)
      expect(relay.lastError).toBeNull()
    })

    it('after a gap drops the pieces of that file and reads it again from where Stocka stops', async () => {
      const fake = fakePi({ [FILE]: 'a1\na2\n' })
      const { stocka, text } = fakeStocka()
      const relay = useLogRelayStore()
      await relay.init()
      relay.index.devices[UUID] = { read: { [FILE]: 3 }, stored: {}, since: null } // read from a later point
      await relay.collect(fake.pi, UUID)

      await relay.flush(stocka)
      expect(relay.pendingPieces).toBe(0)
      expect(relay.index.devices[UUID]!.read[FILE]).toBe(0)

      await relay.collect(fake.pi, UUID)
      await relay.flush(stocka)
      expect(text(FILE)).toBe('a1\na2\n')
    })

    it('resyncs on a 409 while uploading', async () => {
      const fake = fakePi({ [FILE]: 'a1\na2\n' })
      const { stocka, stored, text } = fakeStocka()
      const relay = useLogRelayStore()
      await relay.collect(fake.pi, UUID)
      // Stocka loses the file between the cursor and the upload: the piece now starts after its end.
      const cursor = stocka.logCursor.bind(stocka)
      ;(stocka as unknown as { logCursor: typeof cursor }).logCursor = async (device) => {
        const answer = await cursor(device)
        stored.delete(FILE)
        return { ...answer, files: { [FILE]: 0 } }
      }
      relay.index.pieces[0]!.from = 3
      relay.index.devices[UUID]!.read[FILE] = 6

      await relay.flush(stocka)

      expect(relay.pendingPieces).toBe(0)
      expect(relay.index.devices[UUID]!.read[FILE]).toBe(0)
      await relay.collect(fake.pi, UUID)
      await relay.flush(stocka)
      expect(text(FILE)).toBe('a1\na2\n')
    })

    it('a piece whose file is gone from the phone becomes a gap: dropped and read again, the relay goes on', async () => {
      const fake = fakePi({ [FILE]: 'a1\na2\n', 'player.log': 'p1\n' })
      const { stocka, text } = fakeStocka()
      const relay = useLogRelayStore()
      await relay.collect(fake.pi, UUID)
      const lost = relay.index.pieces.find((p) => p.file === FILE)!
      pieces.pieces.delete(lost.id) // the OS cleaned the app's files

      expect(await relay.flush(stocka)).toBe(3) // player.log still goes

      expect(relay.lastError).toBeNull()
      expect(relay.index.pieces.some((p) => p.file === FILE)).toBe(false)
      expect(relay.index.devices[UUID]!.read[FILE]).toBe(0)
      await relay.collect(fake.pi, UUID)
      await relay.flush(stocka)
      expect(text(FILE)).toBe('a1\na2\n')
    })

    it('does not count an upload Stocka already had as the last upload', async () => {
      const fake = fakePi({ [FILE]: 'a1\n' })
      const { stocka, stored } = fakeStocka()
      const relay = useLogRelayStore()
      await relay.collect(fake.pi, UUID)
      stored.set(FILE, enc.encode('a1\n'))

      await relay.flush(stocka)

      expect(relay.lastUploadAt).toBeNull()
    })

    it('does nothing with an empty queue', async () => {
      const { stocka, uploads } = fakeStocka()
      expect(await useLogRelayStore().flush(stocka)).toBe(0)
      expect(uploads).toEqual([])
    })
  })

  it('remembers the queue across restarts of the app', async () => {
    const fake = fakePi({ [FILE]: 'a1\n' })
    await useLogRelayStore().collect(fake.pi, UUID)
    expect(kv.data.get(KEYS.logRelay)).toBeTruthy()

    setActivePinia(createPinia())
    const relay = useLogRelayStore()
    await relay.init()

    expect(relay.pendingBytes).toBe(3)
    const { stocka, text } = fakeStocka()
    await relay.flush(stocka)
    expect(text(FILE)).toBe('a1\n')
  })
})
