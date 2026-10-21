import { beforeEach, describe, expect, it } from 'vitest'

import { setLocale } from '../i18n'
import type { PiAlert, PiMotor } from '../types'
import { alertTitle, formatAgo, isKnownAlertCode, motorLastEndLabel, motorStateLabel, sensorCanBeCut, sensorOnActiveLabel, timeAgo, unlockableAlerts } from './piLabels'

const NOW = Date.parse('2026-10-21T14:00:00Z')
const alert = (overrides: Partial<PiAlert> = {}): PiAlert => ({ code: 'motor_timeout', port: 'angel', message: '', at: '2026-10-21T13:59:00Z', ...overrides })
const motor = (overrides: Partial<PiMotor> = {}): PiMotor => ({ direction: null, runningS: 0, lastEnd: null, locked: false, blocked: false, limitForward: null, limitReverse: null, ...overrides })

describe('piLabels', () => {
  beforeEach(() => setLocale('ca'))

  describe('alertTitle', () => {
    it.each([
      ['motor_timeout', 'Motor aturat per temps màxim'],
      ['sensor_stop_show', 'Sensor: show aturat'],
      ['sensor_panic', 'Sensor: tot en segur'],
    ])('labels %s', (code, label) => {
      expect(isKnownAlertCode(code)).toBe(true)
      expect(alertTitle({ code })).toBe(label)
    })

    it('falls back to the raw code for unknown codes', () => {
      expect(isKnownAlertCode('relay_stuck')).toBe(false)
      expect(alertTitle({ code: 'relay_stuck' })).toBe('Alerta (relay_stuck)')
    })

    it('does not leave an empty fallback for a blank code', () => {
      expect(alertTitle({ code: '' })).toBe('Alerta (?)')
    })

    it('translates to Spanish', () => {
      setLocale('es')
      expect(alertTitle({ code: 'sensor_panic' })).toBe('Sensor: todo en seguro')
      expect(alertTitle({ code: 'x' })).toBe('Alerta (x)')
    })
  })

  describe('unlockableAlerts', () => {
    it('is empty without alerts', () => {
      expect(unlockableAlerts([], { angel: motor({ locked: true }) }).size).toBe(0)
    })

    it('offers unlock only on the newest timeout of a still locked motor', () => {
      const alerts = [alert(), alert({ at: '2026-10-21T13:00:00Z' }), alert({ port: 'estrella' })]

      const result = unlockableAlerts(alerts, { angel: motor({ locked: true }), estrella: motor({ locked: false }) })

      expect([...result]).toEqual([0])
    })

    it('ignores other codes, alerts without port and unknown motors', () => {
      const alerts = [alert({ code: 'sensor_panic', port: 'angel' }), alert({ port: null }), alert({ port: 'fantasma' })]

      expect(unlockableAlerts(alerts, { angel: motor({ locked: true }) }).size).toBe(0)
    })
  })

  describe('timeAgo / formatAgo', () => {
    it.each([
      ['2026-10-21T13:59:55Z', { unit: 'now', n: 0 }, 'ara mateix'],
      ['2026-10-21T13:59:30Z', { unit: 'seconds', n: 30 }, 'fa 30 s'],
      ['2026-10-21T13:57:00Z', { unit: 'minutes', n: 3 }, 'fa 3 min'],
      ['2026-10-21T11:00:00Z', { unit: 'hours', n: 3 }, 'fa 3 h'],
      ['2026-10-19T14:00:00Z', { unit: 'days', n: 2 }, 'fa 2 dies'],
    ])('%s', (iso, ago, text) => {
      expect(timeAgo(iso, NOW)).toEqual(ago)
      expect(formatAgo(iso, NOW)).toBe(text)
    })

    it('treats a timestamp in the future (stale Pi clock) as now', () => {
      expect(timeAgo('2026-10-21T15:00:00Z', NOW)).toEqual({ unit: 'now', n: 0 })
    })

    it('parses the Pi offset format', () => {
      expect(timeAgo('2026-10-21T13:58:00+00:00', NOW)).toEqual({ unit: 'minutes', n: 2 })
    })

    it('returns null for missing or invalid values and formats them raw', () => {
      expect(timeAgo(null, NOW)).toBeNull()
      expect(timeAgo('ahir', NOW)).toBeNull()
      expect(formatAgo('ahir', NOW)).toBe('ahir')
      expect(formatAgo(undefined, NOW)).toBe('—')
    })
  })

  describe('sensors', () => {
    it('labels every onActive and shows unknown ones raw', () => {
      expect(sensorOnActiveLabel('none')).toBe('no fa res')
      expect(sensorOnActiveLabel('play')).toBe('inicia el show')
      expect(sensorOnActiveLabel('stop_show')).toBe('atura el show')
      expect(sensorOnActiveLabel('panic')).toBe('tot en segur')
      expect(sensorOnActiveLabel('blink')).toBe('blink')
    })

    it('refuses to cut panic sensors only', () => {
      expect(sensorCanBeCut({ onActive: 'panic' })).toBe(false)
      expect(sensorCanBeCut({ onActive: 'play' })).toBe(true)
      expect(sensorCanBeCut(undefined)).toBe(true)
    })
  })

  describe('motors', () => {
    it('describes the direction and the running time', () => {
      expect(motorStateLabel(motor())).toBe('Aturat')
      expect(motorStateLabel(motor({ direction: 'forward', runningS: 1.25 }))).toBe('Girant · 1.3 s')
      expect(motorStateLabel(motor({ direction: 'reverse' }))).toBe('Girant (invertit)')
    })

    it('explains why the last run ended', () => {
      expect(motorLastEndLabel(motor())).toBeNull()
      expect(motorLastEndLabel(motor({ lastEnd: 'limit' }))).toBe('última aturada: final de carrera')
      expect(motorLastEndLabel(motor({ lastEnd: 'max_time' }))).toBe('última aturada: temps màxim')
      expect(motorLastEndLabel({ lastEnd: 'weird' as PiMotor['lastEnd'] })).toBe('última aturada: weird')
    })
  })
})
