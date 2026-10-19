import { describe, expect, it } from 'vitest'

import { bundleFileName, hash8, parseContentDispositionFilename, slugify } from './bundleName'

describe('bundle naming (same rules as the backend and the Pi tools)', () => {
  it('slugifies like ShowBundleWriter.slugify', () => {
    expect(slugify('Pessebre 2026')).toBe('pessebre-2026')
    expect(slugify('  Belén — Nadal!! ')).toBe('bel-n-nadal')
    expect(slugify('')).toBe('show')
    expect(slugify('***')).toBe('show')
  })

  it('builds <slug>-<hash8>.belen.zip', () => {
    expect(bundleFileName('Pessebre 2026', 'sha256:6e46887dabc')).toBe('pessebre-2026-6e46887d.belen.zip')
    expect(hash8('sha256:6e46887dabc')).toBe('6e46887d')
    expect(hash8(null)).toBe('')
  })

  it('parses Content-Disposition file names', () => {
    expect(parseContentDispositionFilename('attachment; filename="a-b.belen.zip"')).toBe('a-b.belen.zip')
    expect(parseContentDispositionFilename("attachment; filename*=UTF-8''p%C3%A8ssebre.zip")).toBe('pèssebre.zip')
    expect(parseContentDispositionFilename('inline')).toBeNull()
    expect(parseContentDispositionFilename(null)).toBeNull()
  })
})
