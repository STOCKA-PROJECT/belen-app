<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../i18n'
import type { PiHardware, PiMotor, PiSensor } from '../types'
import { motorLastEndLabel, motorStateLabel, sensorCanBeCut } from '../util/piLabels'

const props = defineProps<{
  hardware: PiHardware[]
  /** Live motor state by port name (`status.motors`). */
  motors?: Record<string, PiMotor>
  /** Live sensor state by port name (`status.sensors`). */
  sensors?: Record<string, PiSensor>
  busy?: boolean
}>()
const emit = defineEmits<{ toggle: [hw: PiHardware]; clear: []; unlock: [motor: string] }>()
const { t } = useI18n()

const cut = computed(() => props.hardware.filter((h) => h.off).length)

function motorOf(hw: PiHardware): PiMotor | undefined {
  return hw.kind === 'motor' ? props.motors?.[hw.name] : undefined
}

/** A panic sensor ignores overrides: cutting it is refused here (restoring stays possible). */
function cuttable(hw: PiHardware): boolean {
  return hw.kind !== 'sensor' || sensorCanBeCut(props.sensors?.[hw.name])
}
</script>

<template>
  <section class="panel">
    <div class="panel-title">
      <span>{{ t('pi.ports') }}</span>
      <span v-if="cut" class="badge badge-danger">{{ t('pi.cutCount', { count: cut }) }}</span>
    </div>
    <div class="panel-body">
      <p class="small muted">{{ t('pi.portsHint') }}</p>
      <ul v-if="hardware.length" class="list port-list">
        <li v-for="hw in hardware" :key="hw.name" :class="{ 'is-off': hw.off }">
          <div class="list-item-main">
            <span class="port-name truncate">{{ hw.name }}</span>
            <span class="meta">
              {{ hw.kind }}
              <span v-if="hw.off" class="badge badge-danger">{{ t('pi.cutBadge') }}</span>
            </span>
            <span v-if="motorOf(hw)" class="meta motor-state">
              <span :class="motorOf(hw)!.direction ? 'text-ok' : ''">{{ motorStateLabel(motorOf(hw)!) }}</span>
              <span v-if="motorOf(hw)!.locked" class="badge badge-danger">{{ t('pi.motorLocked') }}</span>
              <span v-if="motorLastEndLabel(motorOf(hw)!)">· {{ motorLastEndLabel(motorOf(hw)!) }}</span>
            </span>
            <span v-if="!cuttable(hw)" class="meta">{{ t('pi.sensorNoCut') }}</span>
          </div>
          <div class="list-item-actions">
            <button
              v-if="motorOf(hw)?.locked"
              type="button"
              class="btn btn-sm btn-primary"
              :disabled="busy"
              @click="emit('unlock', hw.name)"
            >
              {{ t('pi.unlock') }}
            </button>
            <button
              type="button"
              class="btn"
              :class="hw.off ? 'btn-primary' : 'btn-danger-solid'"
              :disabled="busy || (!hw.off && !cuttable(hw))"
              :aria-pressed="hw.off"
              @click="emit('toggle', hw)"
            >
              {{ hw.off ? t('pi.restore') : t('pi.cut') }}
            </button>
          </div>
        </li>
      </ul>
      <p v-else class="empty">{{ t('pi.noPorts') }}</p>
      <button v-if="cut" type="button" class="btn btn-block" :disabled="busy" @click="emit('clear')">{{ t('pi.restoreAll') }}</button>
    </div>
  </section>
</template>
