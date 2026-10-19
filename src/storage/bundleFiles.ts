import { concatBytes } from '../util/base64'

/** Receives the bytes of a download, in order. */
export interface ByteSink {
  write(chunk: Uint8Array): Promise<void>
  /** Flushes and finishes the file. */
  close(): Promise<void>
  /** Discards whatever was written. */
  abort(): Promise<void>
}

/** Random access to a stored bundle, what the resumable upload needs. */
export interface BundleSource {
  name: string
  size: number
  /** Bytes `[start, end)`. */
  slice(start: number, end: number): Promise<Uint8Array>
}

/** Where the downloaded `.belen.zip` files live. */
export interface BundleFileStore {
  createWriter(fileName: string): Promise<ByteSink>
  openSource(fileName: string): Promise<BundleSource>
  delete(fileName: string): Promise<void>
  exists(fileName: string): Promise<boolean>
}

/** In-memory store for tests and as a last-resort fallback. */
export function createMemoryBundleFiles(): BundleFileStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>()
  return {
    files,
    async createWriter(fileName) {
      const chunks: Uint8Array[] = []
      return {
        async write(chunk) {
          chunks.push(chunk.slice())
        },
        async close() {
          files.set(fileName, concatBytes(chunks))
        },
        async abort() {
          files.delete(fileName)
        },
      }
    },
    async openSource(fileName) {
      const bytes = files.get(fileName)
      if (!bytes) throw new Error(`No such bundle: ${fileName}`)
      return {
        name: fileName,
        size: bytes.byteLength,
        async slice(start, end) {
          return bytes.subarray(start, end)
        },
      }
    },
    async delete(fileName) {
      files.delete(fileName)
    },
    async exists(fileName) {
      return files.has(fileName)
    },
  }
}
