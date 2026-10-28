<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive } from 'vue'

import { useI18n } from '../i18n'
import { TESTABLE_KINDS } from '../stores/pi'
import type { MotorDirection, PiHardware, PiMotor, PiSensor, PiTestParams } from '../types'
import { audioLabel, hexToRgb, motorLastEndLabel, motorStateLabel, sensorCanBeCut } from '../util/piLabels'

const props = defineProps<{
  hardware: PiHardware[]
  /** Live motor state by port name (`status.motors`). */
  motors?: Record<string, PiMotor>
  /** Live sensor state by port name (`status.sensors`). */
  sensors?: Record<string, PiSensor>
  busy?: boolean
  /** Ports can be tested now: a show is loaded and nothing plays. */
  canTest?: boolean
  /** Why the ports cannot be tested now, when it is worth saying. */
  testBlocked?: 'playing' | 'rehearsal' | null
  /** Ports with a test order in force. */
  testTargets?: Set<string>
  /** The motor whose test button is held. */
  heldMotor?: { name: string; direction: MotorDirection } | null
  /** Audio files of the Pi, for the audio test. */
  audioFiles?: string[]
}>()
const emit = defineEmits<{
  toggle: [hw: PiHardware]
  clear: []
  unlock: [motor: string]
  testOn: [target: string, params: PiTestParams]
  testLive: [target: string, params: PiTestParams]
  testOff: [target: string]
  testOffAll: []
  motorHold: [target: string, direction: MotorDirection]
  motorRelease: []
}>()
const { t } = useI18n()

const DEFAULT_COLOR = '#ff8c32'
const colors = reactive<Record<string, string>>({})
const sounds = reactive<Record<string, string>>({})

const cut = computed(() => props.hardware.filter((h) => h.off).length)
const testingCount = computed(() => props.testTargets?.size ?? 0)

function motorOf(hw: PiHardware): PiMotor | undefined {
  return hw.kind === 'motor' ? props.motors?.[hw.name] : undefined
}

/** A panic sensor ignores overrides: cutting it is refused here (restoring stays possible). */
function cuttable(hw: PiHardware): boolean {
  return hw.kind !== 'sensor' || sensorCanBeCut(props.sensors?.[hw.name])
}

function testable(hw: PiHardware): boolean {
  return TESTABLE_KINDS.includes(hw.kind)
}

function testing(hw: PiHardware): boolean {
  return props.testTargets?.has(hw.name) ?? false
}

function colorOf(hw: PiHardware): string {
  return colors[hw.name] ?? DEFAULT_COLOR
}

function colorParams(hw: PiHardware): PiTestParams {
  const color = hexToRgb(colorOf(hw))
  return hw.kind === 'moving_head' ? { color, intensity: 100 } : { color }
}

function selectedSound(hw: PiHardware): string {
  const chosen = sounds[hw.name]
  return chosen && props.audioFiles?.includes(chosen) ? chosen : (props.audioFiles?.[0] ?? '')
}

/** A light: the colour changes live while it is on; otherwise it is only remembered for «Encén». */
function onColor(hw: PiHardware, event: Event): void {
  colors[hw.name] = (event.target as HTMLInputElement).value
  if (testing(hw)) emit('testLive', hw.name, colorParams(hw))
}

function switchOn(hw: PiHardware): void {
  if (hw.kind === 'relay') emit('testOn', hw.name, { on: true })
  else if (hw.kind === 'audio') emit('testOn', hw.name, { audio_name: selectedSound(hw) })
  else emit('testOn', hw.name, colorParams(hw))
}

function holding(hw: PiHardware, direction: MotorDirection): boolean {
  return props.heldMotor?.name === hw.name && props.heldMotor.direction === direction
}

function hold(hw: PiHardware, direction: MotorDirection, event: PointerEvent): void {
  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  emit('motorHold', hw.name, direction)
}

/** Keyboard: Space or Enter turn the motor while they are held down. */
function holdKey(hw: PiHardware, direction: MotorDirection, event: KeyboardEvent): void {
  if (event.repeat || (event.key !== ' ' && event.key !== 'Enter')) return
  event.preventDefault()
  emit('motorHold', hw.name, direction)
}

function release(): void {
  if (props.heldMotor) emit('motorRelease')
}

// Whatever happens to the finger or the app, a held motor stops.
const onHidden = () => {
  if (document.hidden) release()
}
onMounted(() => {
  window.addEventListener('pointerup', release)
  window.addEventListener('blur', release)
  document.addEventListener('visibilitychange', onHidden)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', release)
  window.removeEventListener('blur', release)
  document.removeEventListener('visibilitychange', onHidden)
  release()
})
</script>

<template>
  <section class="panel">
    <div class="panel-title">
      <span>{{ t('pi.ports') }}</span>
      <span class="row-wrap">
        <span v-if="testingCount" class="badge badge-hl">{{ t('pi.test.active', { count: testingCount }) }}</span>
        <span v-if="cut" class="badge badge-danger">{{ t('pi.cutCount', { count: cut }) }}</span>
      </span>
    </div>
    <div class="panel-body">
      <p class="small muted">
        <template v-if="canTest">{{ t('pi.test.hint') }}</template>
        <template v-else-if="testBlocked === 'rehearsal'">{{ t('pi.test.blockedRehearsal') }}</template>
        <template v-else-if="testBlocked === 'playing'">{{ t('pi.test.blockedPlaying') }}</template>
        {{ t('pi.portsHint') }}
      </p>
      <ul v-if="hardware.length" class="list port-list">
        <li v-for="hw in hardware" :key="hw.name" :class="{ 'is-off': hw.off, 'is-testing': testing(hw) }">
          <div class="port-row">
            <div class="list-item-main">
              <span class="port-name truncate">{{ hw.name }}</span>
              <span v-if="hw.pieces?.length" class="port-pieces">{{ hw.pieces.join(' · ') }}</span>
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
              <button v-if="motorOf(hw)?.locked" type="button" class="btn btn-sm btn-primary" :disabled="busy" @click="emit('unlock', hw.name)">
                {{ t('pi.unlock') }}
              </button>
              <button
                type="button"
                class="btn btn-sm"
                :class="hw.off ? 'btn-primary' : 'btn-quiet btn-cut'"
                :disabled="busy || (!hw.off && !cuttable(hw))"
                :aria-pressed="hw.off"
                @click="emit('toggle', hw)"
              >
                {{ hw.off ? t('pi.restore') : t('pi.cut') }}
              </button>
            </div>
          </div>

          <div v-if="canTest && testable(hw) && !hw.off" class="port-test">
            <template v-if="hw.kind === 'motor'">
              <button
                v-for="direction in ['reverse', 'forward'] as const"
                :key="direction"
                type="button"
                class="btn btn-sm btn-hold"
                :class="{ 'is-held': holding(hw, direction) }"
                :aria-pressed="holding(hw, direction)"
                :disabled="motorOf(hw)?.locked"
                @pointerdown="hold(hw, direction, $event)"
                @pointerup="release"
                @pointercancel="release"
                @lostpointercapture="release"
                @keydown="holdKey(hw, direction, $event)"
                @keyup="release"
                @contextmenu.prevent
              >
                {{ direction === 'reverse' ? `◀ ${t('pi.test.reverse')}` : `${t('pi.test.forward')} ▶` }}
              </button>
              <span class="meta">{{ t('pi.test.hold') }}</span>
            </template>

            <template v-else-if="hw.kind === 'audio'">
              <select
                v-if="audioFiles?.length"
                class="field field-sm grow"
                :aria-label="t('pi.test.sound', { name: hw.name })"
                :value="selectedSound(hw)"
                :disabled="testing(hw)"
                @change="sounds[hw.name] = ($event.target as HTMLSelectElement).value"
              >
                <option v-for="file in audioFiles" :key="file" :value="file">{{ audioLabel(file) }}</option>
              </select>
              <span v-else class="meta grow">{{ t('pi.test.noSounds') }}</span>
              <button
                type="button"
                class="btn btn-sm"
                :class="testing(hw) ? '' : 'btn-primary'"
                :disabled="busy || !audioFiles?.length"
                :aria-pressed="testing(hw)"
                @click="testing(hw) ? emit('testOff', hw.name) : switchOn(hw)"
              >
                {{ testing(hw) ? `■ ${t('pi.test.stop')}` : `▶ ${t('pi.test.play')}` }}
              </button>
            </template>

            <template v-else>
              <input
                v-if="hw.kind !== 'relay'"
                type="color"
                class="color-swatch"
                :value="colorOf(hw)"
                :aria-label="t('pi.test.color', { name: hw.name })"
                @input="onColor(hw, $event)"
              />
              <button
                type="button"
                class="btn btn-sm btn-toggle"
                :class="{ 'is-on': testing(hw) }"
                :disabled="busy"
                :aria-pressed="testing(hw)"
                @click="testing(hw) ? emit('testOff', hw.name) : switchOn(hw)"
              >
                <span class="toggle-dot" aria-hidden="true" />
                {{ testing(hw) ? t('pi.test.off') : t('pi.test.on') }}
              </button>
            </template>
          </div>
          <p v-else-if="canTest && testable(hw) && hw.off" class="meta">{{ t('pi.test.cutFirst') }}</p>
        </li>
      </ul>
      <p v-else class="empty">{{ t('pi.noPorts') }}</p>
      <button v-if="testingCount" type="button" class="btn btn-block" :disabled="busy" @click="emit('testOffAll')">{{ t('pi.test.offAll') }}</button>
      <button v-if="cut" type="button" class="btn btn-block" :disabled="busy" @click="emit('clear')">{{ t('pi.restoreAll') }}</button>
    </div>
  </section>
</template>
