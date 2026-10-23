import { t } from '../i18n'
import { PI_ALERT_CODES, type PiAlert, type PiAlertCode, type PiClock, type PiMotor, type PiRehearsal, type PiSchedule, type PiScheduleDay, type PiSensor, type PiSkippedMotor } from '../types'
import { formatMs } from './format'

/** True for the alert codes the app has a label for. */
export function isKnownAlertCode(code: string): code is PiAlertCode {
  return (PI_ALERT_CODES as readonly string[]).includes(code)
}

/** Short title of an alert: a label per known code, `Alerta (<code>)` otherwise. */
export function alertTitle(alert: Pick<PiAlert, 'code'>): string {
  return isKnownAlertCode(alert.code) ? t(`pi.alert.${alert.code}` as const) : t('pi.alert.unknown', { code: alert.code || '?' })
}

/**
 * Indexes (in the given list, newest first) of the `motor_timeout` alerts that get an unlock
 * button: only the newest one per port, and only while that motor is still locked.
 */
export function unlockableAlerts(alerts: PiAlert[], motors: Record<string, PiMotor>): Set<number> {
  const out = new Set<number>()
  const seen = new Set<string>()
  alerts.forEach((alert, index) => {
    if (alert.code !== 'motor_timeout' || !alert.port || seen.has(alert.port)) return
    seen.add(alert.port)
    if (motors[alert.port]?.locked) out.add(index)
  })
  return out
}

export type AgoUnit = 'now' | 'seconds' | 'minutes' | 'hours' | 'days'

/**
 * How long ago `iso` was. A timestamp in the future (the Pi has no RTC and may boot with a stale
 * clock) counts as "now"; an unparsable one returns null.
 */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): { unit: AgoUnit; n: number } | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return null
  const s = Math.max(0, Math.floor((now - ts) / 1000))
  if (s < 10) return { unit: 'now', n: 0 }
  if (s < 60) return { unit: 'seconds', n: s }
  if (s < 3600) return { unit: 'minutes', n: Math.floor(s / 60) }
  if (s < 86400) return { unit: 'hours', n: Math.floor(s / 3600) }
  return { unit: 'days', n: Math.floor(s / 86400) }
}

/** {@link timeAgo} as text («fa 3 min»); the raw value when it cannot be parsed. */
export function formatAgo(iso: string | null | undefined, now: number = Date.now()): string {
  const ago = timeAgo(iso, now)
  if (!ago) return iso ?? '—'
  return ago.unit === 'now' ? t('pi.ago.now') : t(`pi.ago.${ago.unit}` as const, { n: ago.n })
}

/** What a sensor does when it becomes active, as text; unknown values are shown raw. */
export function sensorOnActiveLabel(onActive: PiSensor['onActive'] | string): string {
  switch (onActive) {
    case 'none':
    case 'play':
    case 'stop_show':
    case 'panic':
      return t(`pi.sensorOn.${onActive}` as const)
    default:
      return String(onActive)
  }
}

/** A measured sensor's reading against its threshold («18.5 cm (≤ 20 cm)»); null for digital sensors. */
export function sensorReadingLabel(sensor: Pick<PiSensor, 'value' | 'unit' | 'threshold' | 'activeWhen'>): string | null {
  if (sensor.value === undefined) return null
  const unit = sensor.unit ? ` ${sensor.unit}` : ''
  const value = sensor.value === null ? t('pi.sensorNoReading') : `${sensor.value}${unit}`
  return `${value} (${sensor.activeWhen === 'above' ? '≥' : '≤'} ${sensor.threshold ?? '?'}${unit})`
}

/** Panic sensors cannot be cut: the Pi keeps reading them whatever the override says. */
export function sensorCanBeCut(sensor: Pick<PiSensor, 'onActive'> | undefined): boolean {
  return sensor?.onActive !== 'panic'
}

/** «Girant», «Girant (invertit)» or «Aturat», plus the running seconds while it turns. */
export function motorStateLabel(motor: Pick<PiMotor, 'direction' | 'runningS'>): string {
  if (motor.direction === 'forward' || motor.direction === 'reverse') {
    const label = t(`pi.motor.${motor.direction}` as const)
    return motor.runningS > 0 ? `${label} · ${motor.runningS.toFixed(1)} s` : label
  }
  return t('pi.motor.stopped')
}

/** Why the last run ended («última aturada: final de carrera»); null when it never ran. */
export function motorLastEndLabel(motor: Pick<PiMotor, 'lastEnd'>): string | null {
  const end = motor.lastEnd
  if (!end) return null
  const known = ['time', 'limit', 'max_time', 'stop', 'blocked', 'locked'] as const
  const reason = (known as readonly string[]).includes(end) ? t(`pi.motorEnd.${end as (typeof known)[number]}` as const) : String(end)
  return t('pi.motorLastEnd', { reason })
}

const SCHEDULE_DAYS: PiScheduleDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

/** «dv 18:30» from a local ISO time of the Pi (no offset: read as local time); the input when unparsable. */
export function piTimeLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = t(`pi.day.${SCHEDULE_DAYS[(d.getDay() + 6) % 7]!}` as const)
  return `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** «Només dl, dv 17:00–21:00» / «Excepte …» */
export function scheduleWindowsLabel(schedule: Pick<PiSchedule, 'rule' | 'windows'>): string {
  const windows = schedule.windows
    .map((w) => `${SCHEDULE_DAYS.filter((d) => w.days.includes(d)).map((d) => t(`pi.day.${d}` as const)).join(', ')} ${w.from}–${w.to}`)
    .join('; ')
  return `${t(schedule.rule === 'allow' ? 'pi.schedule.allow' : 'pi.schedule.block')} ${windows}`
}

/** Whether the button works now and until when; while the Pi lacks the time, that it always works. */
export function scheduleNowLabel(schedule: PiSchedule): string {
  if (!schedule.applies) return t('pi.schedule.ignored')
  const now = t(schedule.open ? 'pi.schedule.open' : 'pi.schedule.closed')
  return schedule.nextChange ? t('pi.schedule.until', { now, when: piTimeLabel(schedule.nextChange) }) : now
}

/** «dv 18:30 (Internet)» or a warning that the Pi does not know the time. */
export function clockLabel(clock: PiClock): string {
  if (!clock.reliable) return t('pi.clock.unreliable')
  return `${piTimeLabel(clock.now)} (${t(clock.source === 'ntp' ? 'pi.clock.ntp' : 'pi.clock.client')})`
}

/** «Pessebre 2026» · 5:10 → 5:40 · en bucle */
export function rehearsalLabel(rehearsal: PiRehearsal): string {
  const parts = [`«${rehearsal.showName || t('common.none')}»`, `${formatMs(rehearsal.fromMs)} → ${formatMs(rehearsal.toMs)}`]
  if (rehearsal.loop) parts.push(t('pi.rehearsal.loop'))
  return parts.join(' · ')
}

/** Why a motor does not move in the rehearsal. */
export function skippedMotorLabel(motor: PiSkippedMotor): string {
  return motor.reason === 'cut'
    ? t('pi.rehearsal.cut', { motor: motor.target })
    : t('pi.rehearsal.unbalanced', { motor: motor.target, forward: motor.forward, reverse: motor.reverse })
}
