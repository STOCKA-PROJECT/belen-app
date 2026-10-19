/** Base64 helpers for the Capacitor Filesystem plugin, which moves binary data as base64 strings. */

const SLICE = 0x8000

/**
 * Encodes bytes as base64. Works on strings of 32 KiB at a time so very large inputs do not blow
 * the argument limit of `String.fromCharCode.apply`.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += SLICE) {
    const part = bytes.subarray(i, Math.min(i + SLICE, bytes.length))
    binary += String.fromCharCode.apply(null, part as unknown as number[])
  }
  return btoa(binary)
}

/** Decodes a base64 string into bytes. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** Concatenates chunks into a single buffer. */
export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0)
  const out = new Uint8Array(total)
  let pos = 0
  for (const c of chunks) {
    out.set(c, pos)
    pos += c.byteLength
  }
  return out
}
