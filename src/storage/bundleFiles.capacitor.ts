import { Capacitor } from '@capacitor/core'
import { Directory, Filesystem } from '@capacitor/filesystem'

import { base64ToBytes, bytesToBase64, concatBytes } from '../util/base64'
import type { BundleFileStore, BundleSource, ByteSink } from './bundleFiles'

/** Sub-directory of `Directory.Data` that holds the bundles. */
export const BUNDLE_DIR = 'bundles'

/**
 * Bytes buffered in JS before each `appendFile`. A multiple of 3 so every appended base64 string is
 * padding-free and the pieces concatenate into valid base64 (matters for the web implementation of
 * the plugin, which keeps the file as one base64 string).
 */
export const APPEND_CHUNK = 768 * 1024

/**
 * Bundles on disk through the Capacitor Filesystem plugin.
 *
 * Memory: downloads stream in {@link APPEND_CHUNK} pieces, so a 50 MB bundle never needs more than
 * about 2 MB of JS memory (the chunk plus its base64 copy); each piece crosses the native bridge as
 * base64 (+33 %) and is appended to the file. Uploads read `[offset, length)` ranges natively
 * (`readFile` with `offset`/`length`, plugin 8.1+), so the chunk in flight is the only thing in
 * memory. On the web (dev in a browser) the plugin has no range reads and the whole file is loaded
 * once into memory; fine for development, not a target platform.
 */
export function createCapacitorBundleFiles(
  fs: typeof Filesystem = Filesystem,
  native: boolean = Capacitor.isNativePlatform(),
): BundleFileStore {
  const directory = Directory.Data
  const pathOf = (fileName: string) => `${BUNDLE_DIR}/${fileName}`

  async function ensureDir(): Promise<void> {
    try {
      await fs.mkdir({ path: BUNDLE_DIR, directory, recursive: true })
    } catch {
      /* already exists */
    }
  }

  async function createWriter(fileName: string): Promise<ByteSink> {
    await ensureDir()
    const path = pathOf(fileName)
    let pending: Uint8Array[] = []
    let pendingBytes = 0
    let started = false

    async function flush(final: boolean): Promise<void> {
      if (pendingBytes === 0 && (started || !final)) return
      let buffer = concatBytes(pending)
      pending = []
      pendingBytes = 0
      if (!final) {
        const keep = buffer.byteLength % 3
        if (keep) {
          pending = [buffer.subarray(buffer.byteLength - keep)]
          pendingBytes = keep
          buffer = buffer.subarray(0, buffer.byteLength - keep)
        }
      }
      const data = bytesToBase64(buffer)
      if (!started) {
        await fs.writeFile({ path, directory, data, recursive: true })
        started = true
      } else if (data.length > 0) {
        await fs.appendFile({ path, directory, data })
      }
    }

    return {
      async write(chunk) {
        pending.push(chunk)
        pendingBytes += chunk.byteLength
        if (pendingBytes >= APPEND_CHUNK) await flush(false)
      },
      async close() {
        await flush(true)
      },
      async abort() {
        pending = []
        pendingBytes = 0
        try {
          await fs.deleteFile({ path, directory })
        } catch {
          /* nothing written yet */
        }
      },
    }
  }

  async function openSource(fileName: string): Promise<BundleSource> {
    const path = pathOf(fileName)
    let whole: Uint8Array | null = null

    async function readWhole(): Promise<Uint8Array> {
      if (whole) return whole
      const result = await fs.readFile({ path, directory })
      if (typeof result.data === 'string') whole = base64ToBytes(result.data)
      else whole = new Uint8Array(await result.data.arrayBuffer())
      return whole
    }

    // Native `stat` reports bytes; the web plugin reports the length of the stored base64 string,
    // so there the real size comes from the decoded bytes (which the web path loads anyway).
    const size = native ? (await fs.stat({ path, directory })).size : (await readWhole()).byteLength

    return {
      name: fileName,
      size,
      async slice(start, end) {
        const length = Math.max(0, Math.min(end, size) - start)
        if (length === 0) return new Uint8Array(0)
        if (native) {
          const result = await fs.readFile({ path, directory, offset: start, length })
          if (typeof result.data === 'string') return base64ToBytes(result.data)
          return new Uint8Array(await result.data.arrayBuffer())
        }
        const all = await readWhole()
        return all.subarray(start, start + length)
      },
    }
  }

  return {
    createWriter,
    openSource,
    async delete(fileName) {
      try {
        await fs.deleteFile({ path: pathOf(fileName), directory })
      } catch {
        /* already gone */
      }
    },
    async exists(fileName) {
      try {
        await fs.stat({ path: pathOf(fileName), directory })
        return true
      } catch {
        return false
      }
    },
  }
}
