/**
 * Naming rules of a `.belen.zip`, identical to `ShowBundleWriter` in the backend and
 * `tools/bundle_tool.py` on the Raspberry Pi: `<slug>-<hash8>.belen.zip`.
 */

/** Lower case, runs of anything but `[a-z0-9]` collapsed to `-`, trimmed; `show` when empty. */
export function slugify(name: string | null | undefined): string {
  const slug = (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return slug || 'show'
}

/** First eight hex characters of a `sha256:<hex>` show hash (what the Pi shows on screen). */
export function hash8(hash: string | null | undefined): string {
  if (!hash) return ''
  return hash.startsWith('sha256:') ? hash.slice(7, 15) : hash.slice(0, 8)
}

export function bundleFileName(showName: string, hash: string): string {
  return `${slugify(showName)}-${hash8(hash)}.belen.zip`
}

/** Extracts `filename="…"` (or `filename*=UTF-8''…`) from a Content-Disposition header. */
export function parseContentDispositionFilename(header: string | null | undefined): string | null {
  if (!header) return null
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*"([^"]+)"|filename\s*=\s*([^;]+)/.exec(header)
  const value = plain?.[1] ?? plain?.[2]
  return value ? value.trim() : null
}
