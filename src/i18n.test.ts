import { describe, expect, it } from 'vitest'

import { detectLocale, format, locale, messages, setLocale, t } from './i18n'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('i18n catalogues', () => {
  it('has every Catalan key in Spanish and vice versa', () => {
    const ca = Object.keys(messages.ca).sort()
    const es = Object.keys(messages.es).sort()
    expect(es).toEqual(ca)
  })

  it('has no empty translations', () => {
    for (const [lang, table] of Object.entries(messages)) {
      for (const [key, value] of Object.entries(table)) {
        expect(value.trim(), `${lang}:${key}`).not.toBe('')
      }
    }
  })

  it('keeps the same placeholders in both languages', () => {
    for (const key of Object.keys(messages.ca) as Array<keyof typeof messages.ca>) {
      expect(placeholders(messages.es[key]), key).toEqual(placeholders(messages.ca[key]))
    }
  })

  it('interpolates named parameters and leaves unknown ones untouched', () => {
    expect(format('{a} i {b} i {c}', { a: 1, b: 'dos' })).toBe('1 i dos i {c}')
  })

  it('translates in the active locale and falls back to Catalan', () => {
    setLocale('ca')
    expect(t('pi.cut')).toBe('Talla')
    setLocale('es')
    expect(t('pi.cut')).toBe('Cortar')
    expect(t('library.count', { count: 3 })).toBe('3 paquetes')
    expect(locale.value).toBe('es')
    setLocale('ca')
  })

  it('picks Spanish only for Spanish device languages', () => {
    expect(detectLocale('es-ES')).toBe('es')
    expect(detectLocale('ES')).toBe('es')
    expect(detectLocale('ca-ES')).toBe('ca')
    expect(detectLocale('en-US')).toBe('ca')
    expect(detectLocale(undefined)).toBe('ca')
  })
})
