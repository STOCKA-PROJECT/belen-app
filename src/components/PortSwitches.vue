<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, watch } from 'vue'

import { useI18n } from '../i18n'
import { headPositionsOf } from '../stores/headPositions'
import { TESTABLE_KINDS } from '../stores/pi'
import type { HeadPosition, HeadProfile, MotorDirection, PiHardware, PiMotor, PiSensor, PiTestParams, StockaPort } from '../types'
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
  /** The organization's `moving_head` ports of Stocka by name (the show's targets carry the same names), for their positions. */
  headPorts?: Record<string, StockaPort>
  /** Fixture profile of each head port by name, for the slider ranges. */
  headProfiles?: Record<string, HeadProfile>
  /** Whether the user may save positions on the ports (OWNER or MANAGER). */
  canSavePositions?: boolean
  /** Saving a position needs Internet (it goes to Stocka). */
  online?: boolean
}>()
const emit = defineEmits<{
  savePosition: [port: string, position: HeadPosition]
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
  return hw.kind === 'moving_head' ? headParams(hw) : { color: hexToRgb(colorOf(hw)) }
}

// ---- moving heads: slider state, saved positions, "save as position" form ----
type HeadKey = 'pan' | 'tilt' | 'zoom' | 'intensity' | 'white'
const HEAD_KEYS: HeadKey[] = ['pan', 'tilt', 'zoom', 'intensity', 'white']
interface HeadState {
  pan: number
  tilt: number
  zoom: number
  intensity: number
  white: number
}
type SaveGroup = 'aim' | 'zoom' | 'intensity' | 'color'
const SAVE_GROUPS: SaveGroup[] = ['aim', 'zoom', 'intensity', 'color']
const SAVE_GROUP_KEY: Record<SaveGroup, 'pi.test.head.includeAim' | 'pi.test.head.includeZoom' | 'pi.test.head.includeIntensity' | 'pi.test.head.includeColor'> = {
  aim: 'pi.test.head.includeAim',
  zoom: 'pi.test.head.includeZoom',
  intensity: 'pi.test.head.includeIntensity',
  color: 'pi.test.head.includeColor',
}
const HEAD_KEY_LABEL: Record<HeadKey, 'pi.test.head.pan' | 'pi.test.head.tilt' | 'pi.test.head.zoom' | 'pi.test.head.intensity' | 'pi.test.head.white'> = {
  pan: 'pi.test.head.pan',
  tilt: 'pi.test.head.tilt',
  zoom: 'pi.test.head.zoom',
  intensity: 'pi.test.head.intensity',
  white: 'pi.test.head.white',
}
interface SaveDraft {
  open: boolean
  name: string
  include: Record<SaveGroup, boolean>
}

const heads = reactive<Record<string, HeadState>>({})
const saveDrafts = reactive<Record<string, SaveDraft>>({})

/** Slider bounds of a head: its profile for pan/tilt/zoom, the `set` action for intensity and white. */
function headBounds(hw: PiHardware): Record<HeadKey, { min: number; max: number; step: number; unit: string }> {
  const p = props.headProfiles?.[hw.name]
  return {
    pan: { min: 0, max: p?.pan.max ?? 540, step: 0.5, unit: '°' },
    tilt: { min: 0, max: p?.tilt.max ?? 190, step: 0.5, unit: '°' },
    zoom: { min: p?.zoom.min ?? 6, max: p?.zoom.max ?? 36, step: 0.5, unit: '°' },
    intensity: { min: 0, max: 100, step: 1, unit: '%' },
    white: { min: 0, max: 255, step: 1, unit: '' },
  }
}

/** Where the sliders of a head stand; starts centred, closed and at full intensity. */
function headState(hw: PiHardware): HeadState {
  let state = heads[hw.name]
  if (!state) {
    const b = headBounds(hw)
    state = { pan: Math.round(b.pan.max / 2), tilt: Math.round(b.tilt.max / 2), zoom: b.zoom.min, intensity: 100, white: 0 }
    heads[hw.name] = state
  }
  return state
}

function headParams(hw: PiHardware): PiTestParams {
  const s = headState(hw)
  return { pan: s.pan, tilt: s.tilt, zoom: s.zoom, intensity: s.intensity, white: s.white, color: hexToRgb(colorOf(hw)) }
}

/** A slider moved: the head follows live while it is on; otherwise the value waits for «Encén». */
function onHead(hw: PiHardware, key: HeadKey, event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  headState(hw)[key] = raw
  if (testing(hw)) emit('testLive', hw.name, headParams(hw))
}

function savedPositions(hw: PiHardware): HeadPosition[] {
  return headPositionsOf(props.headPorts?.[hw.name]?.config)
}

function toHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')
}

/** Sends the head to a saved position: the sliders take its values (the rest stay) and the head moves, switching on if needed. */
function goTo(hw: PiHardware, position: HeadPosition): void {
  const state = headState(hw)
  for (const key of HEAD_KEYS) {
    const value = position[key]
    if (typeof value === 'number') state[key] = value
  }
  if (position.color) colors[hw.name] = toHex(position.color)
  if (testing(hw)) emit('testLive', hw.name, headParams(hw))
  else emit('testOn', hw.name, headParams(hw))
}

function saveDraft(hw: PiHardware): SaveDraft {
  let draft = saveDrafts[hw.name]
  if (!draft) {
    draft = { open: false, name: '', include: { aim: true, zoom: true, intensity: true, color: true } }
    saveDrafts[hw.name] = draft
  }
  return draft
}

function canConfirmSave(hw: PiHardware): boolean {
  const draft = saveDraft(hw)
  return !!props.online && draft.name.trim() !== '' && SAVE_GROUPS.some((g) => draft.include[g])
}

/** Builds the position from the sliders and the chosen groups and hands it to the view, which saves it on the Stocka port. */
function confirmSave(hw: PiHardware): void {
  const draft = saveDraft(hw)
  if (!canConfirmSave(hw)) return
  const s = headState(hw)
  const position: HeadPosition = { name: draft.name.trim() }
  if (draft.include.aim) {
    position.pan = s.pan
    position.tilt = s.tilt
  }
  if (draft.include.zoom) position.zoom = s.zoom
  if (draft.include.intensity) position.intensity = s.intensity
  if (draft.include.color) {
    position.color = hexToRgb(colorOf(hw))
    position.white = s.white
  }
  emit('savePosition', hw.name, position)
  draft.open = false
  draft.name = ''
}

/** Whether saving would replace a position the port already has (same name, case-insensitive). */
function replacesExisting(hw: PiHardware): boolean {
  const name = saveDraft(hw).name.trim().toLowerCase()
  return name !== '' && savedPositions(hw).some((p) => p.name.trim().toLowerCase() === name)
}

function formatHeadValue(hw: PiHardware, key: HeadKey): string {
  const value = headState(hw)[key]
  return `${Number.isInteger(value) ? value : value.toFixed(1)}${headBounds(hw)[key].unit}`
}

// The slider state and the save form of every head exist before the template reads them.
watch(
  () => props.hardware,
  (list) => {
    for (const hw of list) {
      if (hw.kind !== 'moving_head') continue
      headState(hw)
      saveDraft(hw)
    }
  },
  { immediate: true },
)

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

              <template v-if="hw.kind === 'moving_head'">
                <div class="head-sliders">
                  <label v-for="key in HEAD_KEYS" :key="key" class="head-slider">
                    <span class="head-slider-top">
                      <span class="meta">{{ t(HEAD_KEY_LABEL[key]) }}</span>
                      <span class="mono head-value">{{ formatHeadValue(hw, key) }}</span>
                    </span>
                    <input
                      type="range"
                      class="head-range"
                      :min="headBounds(hw)[key].min"
                      :max="headBounds(hw)[key].max"
                      :step="headBounds(hw)[key].step"
                      :value="headState(hw)[key]"
                      :aria-label="`${t(HEAD_KEY_LABEL[key])} · ${hw.name}`"
                      @input="onHead(hw, key, $event)"
                    />
                  </label>
                </div>

                <div class="row-wrap head-positions">
                  <span class="meta">{{ t('pi.test.head.positions') }}</span>
                  <template v-if="savedPositions(hw).length">
                    <button
                      v-for="position in savedPositions(hw)"
                      :key="position.name"
                      type="button"
                      class="btn btn-sm"
                      :disabled="busy"
                      :title="t('pi.test.head.goto', { name: position.name })"
                      @click="goTo(hw, position)"
                    >
                      ◎ {{ position.name }}
                    </button>
                  </template>
                  <span v-else class="meta">{{ headPorts?.[hw.name] ? t('pi.test.head.positionsNone') : t('pi.test.head.noPort') }}</span>
                  <button
                    v-if="canSavePositions && headPorts?.[hw.name]"
                    type="button"
                    class="btn btn-sm head-save-btn"
                    :class="{ 'btn-primary': !saveDraft(hw).open }"
                    :disabled="busy"
                    :aria-expanded="saveDraft(hw).open"
                    @click="saveDraft(hw).open = !saveDraft(hw).open"
                  >
                    {{ saveDraft(hw).open ? t('common.cancel') : t('pi.test.head.save') }}
                  </button>
                  <span v-else-if="headPorts?.[hw.name] && !canSavePositions" class="meta">{{ t('pi.test.head.readOnly') }}</span>
                </div>

                <form v-if="canSavePositions && headPorts?.[hw.name] && saveDraft(hw).open" class="head-save" @submit.prevent="confirmSave(hw)">
                  <p class="small muted">{{ online ? t('pi.test.head.saveHelp') : t('pi.test.head.offline') }}</p>
                  <div class="row-wrap">
                    <input
                      v-model="saveDraft(hw).name"
                      type="text"
                      class="field field-sm grow"
                      :list="`head-positions-${hw.name}`"
                      :placeholder="t('pi.test.head.namePlaceholder')"
                      :aria-label="t('pi.test.head.name')"
                      maxlength="80"
                    />
                    <datalist :id="`head-positions-${hw.name}`">
                      <option v-for="position in savedPositions(hw)" :key="position.name" :value="position.name" />
                    </datalist>
                    <button type="submit" class="btn btn-sm btn-primary" :disabled="busy || !canConfirmSave(hw)">
                      {{ replacesExisting(hw) ? t('pi.test.head.replace') : t('pi.test.head.confirm') }}
                    </button>
                  </div>
                  <div class="row-wrap head-groups">
                    <label v-for="group in SAVE_GROUPS" :key="group" class="head-group">
                      <input v-model="saveDraft(hw).include[group]" type="checkbox" />
                      {{ t(SAVE_GROUP_KEY[group]) }}
                    </label>
                  </div>
                </form>
              </template>
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

<style scoped>
.head-sliders { display: grid; width: 100%; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px 14px; }
.head-slider { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.head-slider-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.head-value { font-size: 12px; color: var(--c-ink); }
.head-range { width: 100%; height: 28px; margin: 0; accent-color: var(--c-accent); touch-action: pan-y; }
.head-positions { width: 100%; align-items: center; }
.head-save-btn { margin-left: auto; }
.head-save { display: flex; width: 100%; flex-direction: column; gap: 8px; border-radius: 6px; border: 1px dashed var(--c-line-strong); padding: 8px 10px; }
.head-groups { gap: 6px 14px; }
.head-group { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--c-ink); }
</style>
