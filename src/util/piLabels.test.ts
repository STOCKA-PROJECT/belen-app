import { beforeEach, describe, expect, it } from 'vitest'

import { setLocale } from '../i18n'
import type { PiAlert, PiMotor, PiSchedule } from '../types'
import { alertTitle, clockLabel, formatAgo, isKnownAlertCode, motorLastEndLabel, motorStateLabel, piTimeLabel, scheduleNowLabel, scheduleWindowsLabel, sensorCanBeCut, sensorOnActiveLabel, sensorReadingLabel, timeAgo, unlockableAlerts } from './piLabels'

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

    it('shows the reading of a measured sensor against its threshold, nothing for a digital one', () => {
      expect(sensorReadingLabel({ value: 18.5, unit: 'cm', threshold: 20, activeWhen: 'below' })).toBe('18.5 cm (≤ 20 cm)')
      expect(sensorReadingLabel({ value: null, unit: '°C', threshold: 40, activeWhen: 'above' })).toBe('sense lectura (≥ 40 °C)')
      expect(sensorReadingLabel({})).toBeNull()
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

describe('schedule and clock labels', () => {
  beforeEach(() => setLocale('ca'))
  const schedule = (overrides: Partial<PiSchedule> = {}): PiSchedule => ({
    rule: 'allow',
    windows: [{ days: ['fri', 'mon'], from: '17:00', to: '21:00' }],
    applies: true,
    open: true,
    nextChange: '2026-10-23T21:00',
    ...overrides,
  })

  it('formats the Pi local time with the day', () => {
    expect(piTimeLabel('2026-10-23T18:30:05')).toBe('dv 18:30')
    expect(piTimeLabel('nope')).toBe('nope')
    setLocale('es')
    expect(piTimeLabel('2026-10-24T09:05')).toBe('sá 09:05')
  })

  it('lists the windows in week order with the rule', () => {
    expect(scheduleWindowsLabel(schedule())).toBe('Només dl, dv 17:00–21:00')
    expect(scheduleWindowsLabel(schedule({ rule: 'block', windows: [{ days: ['sun'], from: '13:00', to: '16:00' }, { days: ['sat'], from: '22:00', to: '02:00' }] })))
      .toBe('Excepte dg 13:00–16:00; ds 22:00–02:00')
  })

  it('says whether the button works now and until when', () => {
    expect(scheduleNowLabel(schedule())).toBe('ara funciona fins dv 21:00')
    expect(scheduleNowLabel(schedule({ open: false, nextChange: null }))).toBe('ara no funciona')
    expect(scheduleNowLabel(schedule({ applies: false }))).toContain('funciona sempre')
  })

  it('labels the clock by source and warns when unreliable', () => {
    expect(clockLabel({ reliable: true, source: 'ntp', now: '2026-10-23T18:30:00' })).toBe('dv 18:30 (Internet)')
    expect(clockLabel({ reliable: true, source: 'client', now: '2026-10-23T18:30:00' })).toBe('dv 18:30 (d’un mòbil o un ordinador)')
    expect(clockLabel({ reliable: false, source: null, now: '2026-10-23T18:30:00' })).toContain('No la sap')
  })
})
