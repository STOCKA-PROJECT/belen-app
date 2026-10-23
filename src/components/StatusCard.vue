<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../i18n'
import type { PiInfo, PiStatus } from '../types'
import { formatBytes, formatMs, formatUptime, percent } from '../util/format'
import { clockLabel, scheduleNowLabel, scheduleWindowsLabel } from '../util/piLabels'

const props = defineProps<{ status: PiStatus | null; info: PiInfo | null }>()
const { t } = useI18n()

const STATE_BADGE: Record<string, string> = { PLAYING: 'badge-ok', IDLE: 'badge-brand', SAFE: 'badge-warn', ERROR: 'badge-danger', TEST: 'badge-hl', BOOT: '' }

const stateClass = computed(() => STATE_BADGE[props.status?.state ?? ''] ?? '')
const stateLabel = computed(() => {
  const s = props.status?.state
  return s ? t(`pi.state.${s}` as const) : '—'
})
const modeLabel = computed(() => {
  const mode = props.status?.mode
  if (!mode) return '—'
  const key = `pi.mode.${mode.on}`
  const label = key === 'pi.mode.once' || key === 'pi.mode.loop' || key === 'pi.mode.pulse' ? t(key) : mode.on
  return mode.on === 'pulse' ? `${label} × ${mode.cycles}` : label
})
const playing = computed(() => props.status?.state === 'PLAYING')
const cycleText = computed(() => {
  const s = props.status
  if (!s || !playing.value) return '—'
  const target = s.cyclesTarget ? ` / ${s.cyclesTarget}` : ''
  return `${s.cycle}${target} · ${formatMs(s.cycleMs)} / ${formatMs(s.durationMs ?? 0)}`
})
const cyclePercent = computed(() => (playing.value ? percent(props.status?.cycleMs ?? 0, props.status?.durationMs) : 0))
</script>

<template>
  <section class="panel">
    <div class="panel-title">
      <span>{{ t('pi.status') }}</span>
      <span class="badge" :class="stateClass">{{ stateLabel }}</span>
    </div>
    <div class="panel-body">
      <div class="row-between">
        <div class="grow">
          <span class="label">{{ t('pi.show') }}</span>
          <div class="state-big truncate">{{ status?.showName || t('common.none') }}</div>
        </div>
      </div>
      <div class="kpi">
        <div>
          <span class="label">{{ t('pi.mode') }}</span>
          <span class="value">{{ modeLabel }}</span>
        </div>
        <div>
          <span class="label">{{ t('pi.cycle') }}</span>
          <span class="value">{{ cycleText }}</span>
        </div>
        <div v-if="info">
          <span class="label">{{ t('pi.uptime') }}</span>
          <span class="value">{{ formatUptime(status?.uptimeS ?? info.uptimeS) }}</span>
        </div>
        <div v-if="info">
          <span class="label">{{ t('pi.free') }}</span>
          <span class="value">{{ formatBytes(status?.freeBytes ?? info.freeBytes) }}</span>
        </div>
      </div>
      <div class="progress" :class="{ 'is-ok': playing }">
        <span :style="{ width: `${cyclePercent}%` }" />
      </div>
      <div v-if="status?.schedule">
        <span class="label">{{ t('pi.schedule') }}</span>
        <div class="value">{{ scheduleWindowsLabel(status.schedule) }}</div>
        <div class="value">{{ scheduleNowLabel(status.schedule) }}</div>
      </div>
      <div v-if="status?.clock">
        <span class="label">{{ t('pi.clock') }}</span>
        <div class="value" :class="{ 'text-warn': !status.clock.reliable }">{{ clockLabel(status.clock) }}</div>
      </div>
      <p v-if="status?.lastError" class="notice notice-danger">
        <strong>{{ t('pi.lastError') }}:</strong> {{ status.lastError }}
      </p>
    </div>
  </section>
</template>
