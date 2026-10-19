import type { Filesystem } from '@capacitor/filesystem'
import { describe, expect, it } from 'vitest'

import { base64ToBytes, bytesToBase64 } from '../util/base64'
import { APPEND_CHUNK, createCapacitorBundleFiles } from './bundleFiles.capacitor'

/** Just enough of the Filesystem plugin: files as byte arrays, base64 across the "bridge". */
function fakeFilesystem(options: { statReportsBase64?: boolean } = {}) {
  const files = new Map<string, Uint8Array>()
  const log: string[] = []
  const join = (a: Uint8Array, b: Uint8Array) => {
    const out = new Uint8Array(a.byteLength + b.byteLength)
    out.set(a)
    out.set(b, a.byteLength)
    return out
  }
  const fs = {
    async mkdir() {
      log.push('mkdir')
    },
    async writeFile({ path, data }: { path: string; data: string }) {
      log.push(`write ${data.length}`)
      files.set(path, base64ToBytes(data))
      return { uri: path }
    },
    async appendFile({ path, data }: { path: string; data: string }) {
      log.push(`append ${data.length}`)
      expect(data.endsWith('='), 'intermediate base64 pieces must be padding-free').toBe(false)
      files.set(path, join(files.get(path) ?? new Uint8Array(0), base64ToBytes(data)))
    },
    async readFile({ path, offset, length }: { path: string; offset?: number; length?: number }) {
      const bytes = files.get(path)
      if (!bytes) throw new Error('ENOENT')
      log.push(`read ${offset ?? 0}+${length ?? -1}`)
      const start = offset ?? 0
      const end = length && length > 0 ? start + length : bytes.byteLength
      return { data: bytesToBase64(bytes.subarray(start, end)) }
    },
    async stat({ path }: { path: string }) {
      const bytes = files.get(path)
      if (!bytes) throw new Error('ENOENT')
      // the web plugin stores base64 and reports its length; native reports bytes
      return { size: options.statReportsBase64 ? bytesToBase64(bytes).length : bytes.byteLength, type: 'file', mtime: 0, uri: path }
    },
    async deleteFile({ path }: { path: string }) {
      if (!files.delete(path)) throw new Error('ENOENT')
    },
  }
  return { fs: fs as unknown as typeof Filesystem, files, log }
}

function pattern(size: number): Uint8Array {
  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) out[i] = (i * 31 + 7) & 0xff
  return out
}

describe('createCapacitorBundleFiles', () => {
  it('streams a download to disk in base64 pieces and reassembles the exact bytes', async () => {
    const { fs, files, log } = fakeFilesystem()
    const store = createCapacitorBundleFiles(fs, true)
    const data = pattern(APPEND_CHUNK * 2 + 12345)

    const writer = await store.createWriter('a.belen.zip')
    // odd-sized chunks so the multiple-of-3 bookkeeping is exercised
    let pos = 0
    for (const size of [100001, 700000, 500000, 300000, 12345, 1]) {
      await writer.write(data.subarray(pos, pos + size))
      pos += size
    }
    await writer.write(data.subarray(pos))
    await writer.close()

    expect(files.get('bundles/a.belen.zip')).toEqual(data)
    expect(log.filter((l) => l.startsWith('write'))).toHaveLength(1)
    expect(log.filter((l) => l.startsWith('append')).length).toBeGreaterThanOrEqual(1)
    expect(await store.exists('a.belen.zip')).toBe(true)
  })

  it('writes an empty file when the download had no bytes and abort removes partial files', async () => {
    const { fs, files } = fakeFilesystem()
    const store = createCapacitorBundleFiles(fs, true)

    const w1 = await store.createWriter('empty.zip')
    await w1.close()
    expect(files.get('bundles/empty.zip')).toEqual(new Uint8Array(0))

    const w2 = await store.createWriter('partial.zip')
    await w2.write(pattern(APPEND_CHUNK + 1))
    await w2.abort()
    expect(files.has('bundles/partial.zip')).toBe(false)
    expect(await store.exists('partial.zip')).toBe(false)
  })

  it('reads upload chunks with native range reads and falls back to a single full read on the web', async () => {
    const { fs, files, log } = fakeFilesystem()
    const data = pattern(10000)
    files.set('bundles/b.belen.zip', data)

    const native = await createCapacitorBundleFiles(fs, true).openSource('b.belen.zip')
    expect(native.size).toBe(10000)
    expect(await native.slice(4000, 7000)).toEqual(data.subarray(4000, 7000))
    expect(await native.slice(9000, 20000)).toEqual(data.subarray(9000))
    expect(log.filter((l) => l.startsWith('read'))).toEqual(['read 4000+3000', 'read 9000+1000'])

    log.length = 0
    const webFs = fakeFilesystem({ statReportsBase64: true })
    webFs.files.set('bundles/b.belen.zip', data)
    const web = await createCapacitorBundleFiles(webFs.fs, false).openSource('b.belen.zip')
    expect(web.size).toBe(10000)
    expect(await web.slice(0, 10)).toEqual(data.subarray(0, 10))
    expect(await web.slice(5000, 6000)).toEqual(data.subarray(5000, 6000))
    expect(webFs.log.filter((l) => l.startsWith('read'))).toEqual(['read 0+-1'])
  })

  it('deleting a missing file is not an error', async () => {
    const { fs } = fakeFilesystem()
    await expect(createCapacitorBundleFiles(fs, true).delete('nope.zip')).resolves.toBeUndefined()
  })
})
