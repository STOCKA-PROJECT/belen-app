import { Directory, Filesystem } from '@capacitor/filesystem'

import { base64ToBytes, bytesToBase64 } from '../util/base64'
import type { LogPieceStore } from './logPieces'

/** Sub-directory of `Directory.Data` that holds the log pieces waiting for Internet. */
export const LOG_PIECE_DIR = 'log-pieces'

/** Log pieces on disk through the Capacitor Filesystem plugin, one file each (at most half a MiB). */
export function createCapacitorLogPieces(fs: typeof Filesystem = Filesystem): LogPieceStore {
  const directory = Directory.Data
  const pathOf = (id: string) => `${LOG_PIECE_DIR}/${id}`
  return {
    async write(id, bytes) {
      await fs.writeFile({ path: pathOf(id), directory, data: bytesToBase64(bytes), recursive: true })
    },
    async read(id) {
      const result = await fs.readFile({ path: pathOf(id), directory })
      return typeof result.data === 'string' ? base64ToBytes(result.data) : new Uint8Array(await result.data.arrayBuffer())
    },
    async remove(id) {
      try {
        await fs.deleteFile({ path: pathOf(id), directory })
      } catch {
        /* already gone */
      }
    },
  }
}
