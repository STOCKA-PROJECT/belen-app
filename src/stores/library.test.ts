import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import type { StockaClient } from '../api/stocka'
import { StockaApiError } from '../api/stocka'
import { setStorage } from '../storage'
import { createMemoryBundleFiles } from '../storage/bundleFiles'
import { createMemoryKv } from '../storage/kv'
import type { LibraryEntry, Organization, Timeline } from '../types'
import { downloadKey, useLibraryStore } from './library'

const org: Organization = { id: 1, name: 'Parròquia', slug: 'parroquia', currentUserRole: 'USER' }
const timeline: Timeline = { id: 12, organizationId: 1, name: 'Pessebre 2026', createdAt: null, updatedAt: null }
const HASH_A = 'sha256:' + '6e46887d'.padEnd(64, 'a')
const HASH_B = 'sha256:' + 'b1b2b3b4'.padEnd(64, 'b')

function entry(overrides: Partial<LibraryEntry> = {}): LibraryEntry {
  return {
    fileName: 'pessebre-2026-6e46887d.belen.zip',
    hash: HASH_A,
    name: 'Pessebre 2026',
    orgSlug: 'parroquia',
    orgName: 'Parròquia',
    timelineId: 12,
    size: 3,
    downloadedAt: '2026-10-19T10:00:00.000Z',
    ...overrides,
  }
}

/** A Stocka client that serves one show with the given hash and bytes. */
function fakeClient(hash: string, bytes: Uint8Array, name = 'Pessebre 2026', fail?: StockaApiError) {
  const calls: string[] = []
  const client = {
    async getShowMeta(slug: string, id: number) {
      calls.push(`show ${slug}/${id}`)
      if (fail) throw fail
      return { name, timelineId: id, hash }
    },
    async downloadBundle(slug: string, id: number, sink: { write(c: Uint8Array): Promise<void> }, options?: { onProgress?: (r: number, t: number | null) => void }) {
      calls.push(`bundle ${slug}/${id}`)
      await sink.write(bytes.subarray(0, 2))
      options?.onProgress?.(2, bytes.byteLength)
      await sink.write(bytes.subarray(2))
      options?.onProgress?.(bytes.byteLength, bytes.byteLength)
      return { bytes: bytes.byteLength, fileName: null }
    },
  }
  return { client: client as unknown as StockaClient, calls }
}

describe('library store', () => {
  let kv: ReturnType<typeof createMemoryKv>
  let files: ReturnType<typeof createMemoryBundleFiles>

  beforeEach(() => {
    kv = createMemoryKv()
    files = createMemoryBundleFiles()
    setStorage({ kv, files })
    setActivePinia(createPinia())
  })

  it('starts empty and persists added entries as JSON in Preferences', async () => {
    const library = useLibraryStore()
    await library.init()
    expect(library.entries).toEqual([])
    expect(library.ready).toBe(true)

    await library.add(entry())

    expect(library.count).toBe(1)
    expect(JSON.parse(kv.data.get('library.index')!)).toEqual([entry()])
  })

  it('restores the persisted index and ignores malformed rows', async () => {
    kv.data.set('library.index', JSON.stringify([entry(), { fileName: 'broken' }, 'nope']))
    const library = useLibraryStore()
    await library.init()
    expect(library.entries).toEqual([entry()])
    expect(library.findByTimeline('parroquia', 12)?.hash).toBe(HASH_A)
    expect(library.findByHash(HASH_A)?.fileName).toBe(entry().fileName)
  })

  it('replaces the entry of the same timeline when a new version is added', async () => {
    const library = useLibraryStore()
    await library.init()
    await library.add(entry())
    await library.add(entry({ fileName: 'pessebre-2026-b1b2b3b4.belen.zip', hash: HASH_B, downloadedAt: '2026-10-20T10:00:00.000Z' }))

    expect(library.entries.map((e) => e.hash)).toEqual([HASH_B])
    expect(library.sorted[0]?.hash).toBe(HASH_B)
  })

  it('removes the entry and deletes the file', async () => {
    const library = useLibraryStore()
    await library.init()
    files.files.set(entry().fileName, new Uint8Array([1, 2, 3]))
    await library.add(entry())

    await library.remove(entry().fileName)

    expect(library.entries).toEqual([])
    expect(files.files.has(entry().fileName)).toBe(false)
    expect(JSON.parse(kv.data.get('library.index')!)).toEqual([])
  })

  it('downloads a bundle: show meta for the name, streamed file, indexed entry with the full hash', async () => {
    const library = useLibraryStore()
    await library.init()
    const { client, calls } = fakeClient(HASH_A, new Uint8Array([1, 2, 3, 4, 5]))

    const result = await library.download(client, org, timeline)

    expect(calls).toEqual(['show parroquia/12', 'bundle parroquia/12'])
    expect(result.fileName).toBe('pessebre-2026-6e46887d.belen.zip')
    expect(result.hash).toBe(HASH_A)
    expect(result.size).toBe(5)
    expect(files.files.get(result.fileName)).toEqual(new Uint8Array([1, 2, 3, 4, 5]))
    expect(library.downloads[downloadKey('parroquia', 12)]).toMatchObject({ phase: 'done', received: 5, total: 5 })
    expect(library.findByTimeline('parroquia', 12)).toEqual(result)
  })

  it('does not download again when the same hash is already in the library', async () => {
    const library = useLibraryStore()
    await library.init()
    const first = fakeClient(HASH_A, new Uint8Array([1, 2, 3]))
    await library.download(first.client, org, timeline)
    const second = fakeClient(HASH_A, new Uint8Array([9, 9, 9]))

    await library.download(second.client, org, timeline)

    expect(second.calls).toEqual(['show parroquia/12'])
    expect(files.files.get('pessebre-2026-6e46887d.belen.zip')).toEqual(new Uint8Array([1, 2, 3]))
  })

  it('replaces the old file when the show changed', async () => {
    const library = useLibraryStore()
    await library.init()
    await library.download(fakeClient(HASH_A, new Uint8Array([1, 2, 3])).client, org, timeline)

    await library.download(fakeClient(HASH_B, new Uint8Array([4, 5, 6])).client, org, timeline)

    expect([...files.files.keys()]).toEqual(['pessebre-2026-b1b2b3b4.belen.zip'])
    expect(library.entries.map((e) => e.hash)).toEqual([HASH_B])
  })

  it('records the error phase and rethrows when the show cannot be exported', async () => {
    const library = useLibraryStore()
    await library.init()
    const err = new StockaApiError(422, 'timeline_shows.invalid', 'x', {}, [{ level: 'error', code: 'E_NO_PORT', message: 'm' }])
    const { client } = fakeClient(HASH_A, new Uint8Array(0), 'x', err)

    await expect(library.download(client, org, timeline)).rejects.toBe(err)

    expect(library.downloads[downloadKey('parroquia', 12)]).toMatchObject({ phase: 'error', error: err })
    expect(library.entries).toEqual([])
    expect(files.files.size).toBe(0)
  })
})
