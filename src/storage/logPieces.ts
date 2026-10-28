/**
 * Pieces of a player's log the app carries to Stocka: what it read from the Pi at the belén, kept
 * on the phone until it has Internet. Each piece is a small blob addressed by an id; the queue
 * itself (which piece is which file and offset) lives in the key-value store. The production
 * implementation is `logPieces.capacitor.ts`; tests use the in-memory one.
 */
export interface LogPieceStore {
  write(id: string, bytes: Uint8Array): Promise<void>
  read(id: string): Promise<Uint8Array>
  remove(id: string): Promise<void>
}

export function createMemoryLogPieces(): LogPieceStore & { pieces: Map<string, Uint8Array> } {
  const pieces = new Map<string, Uint8Array>()
  return {
    pieces,
    async write(id, bytes) {
      pieces.set(id, bytes.slice())
    },
    async read(id) {
      const bytes = pieces.get(id)
      if (!bytes) throw new Error(`No such log piece: ${id}`)
      return bytes
    },
    async remove(id) {
      pieces.delete(id)
    },
  }
}
