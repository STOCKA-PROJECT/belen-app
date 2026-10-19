/**
 * Key-value persistence used for small JSON documents (session, settings, library index). The
 * production implementation lives in `kv.capacitor.ts` (Capacitor Preferences); tests use the
 * in-memory one.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

export function createMemoryKv(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    async get(key) {
      return data.get(key) ?? null
    },
    async set(key, value) {
      data.set(key, value)
    },
    async remove(key) {
      data.delete(key)
    },
  }
}

/** Reads and parses a JSON document; `null` when absent or unreadable. */
export async function readJson<T>(kv: KeyValueStore, key: string): Promise<T | null> {
  const raw = await kv.get(key)
  if (raw == null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export async function writeJson(kv: KeyValueStore, key: string, value: unknown): Promise<void> {
  await kv.set(key, JSON.stringify(value))
}
