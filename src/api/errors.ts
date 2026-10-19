/** Errors shared by both API clients. */

/** The device has no route to the server (DNS, Wi-Fi, timeout) or the fetch was aborted. */
export class NetworkError extends Error {
  readonly aborted: boolean

  constructor(message: string, aborted = false) {
    super(message)
    this.name = 'NetworkError'
    this.aborted = aborted
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException ? err.name === 'AbortError' : (err as { name?: string } | null)?.name === 'AbortError'
}

/** Runs `fetch` and converts transport failures into {@link NetworkError}. */
export async function safeFetch(fetchImpl: typeof fetch, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchImpl(url, init)
  } catch (err) {
    if (isAbortError(err)) throw new NetworkError('aborted', true)
    throw new NetworkError(err instanceof Error ? err.message : String(err))
  }
}

export async function readJsonBody(res: Response): Promise<unknown> {
  try {
    const text = await res.text()
    return text ? (JSON.parse(text) as unknown) : null
  } catch {
    return null
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
