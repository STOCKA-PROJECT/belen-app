/** Joins a base URL and a path without doubling or dropping slashes. */
export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

/** Normalises what the user typed as a Pi address: adds `http://` and the default port. */
export function normalizePiUrl(input: string, defaultPort = 8080): string {
  let value = input.trim()
  if (!value) return value
  if (value.startsWith('/')) return value.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`
  try {
    const url = new URL(value)
    if (!url.port && url.protocol === 'http:') url.port = String(defaultPort)
    url.pathname = url.pathname.replace(/\/+$/, '')
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/+$/, '')
  } catch {
    return value.replace(/\/+$/, '')
  }
}

/** Normalises the Stocka base URL (scheme required, trailing slash removed). */
export function normalizeBaseUrl(input: string): string {
  let value = input.trim()
  if (!value) return value
  if (value.startsWith('/')) return value.replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`
  return value.replace(/\/+$/, '')
}
