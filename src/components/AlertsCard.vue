<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { useI18n } from '../i18n'
import type { PiAlert, PiMotor } from '../types'
import { formatDate } from '../util/format'
import { alertTitle, formatAgo, unlockableAlerts } from '../util/piLabels'

/** Alerts of the player (newest first). Renders nothing while there are none. */
const props = defineProps<{ alerts: PiAlert[]; motors: Record<string, PiMotor>; busy?: boolean }>()
const emit = defineEmits<{ clear: []; unlock: [motor: string] }>()
const { t, locale } = useI18n()

const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 15_000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

const unlockable = computed(() => unlockableAlerts(props.alerts, props.motors))
</script>

<template>
  <section v-if="alerts.length" class="panel panel-alert" role="alert" aria-live="assertive">
    <div class="panel-title">
      <span class="alert-heading"><span class="alert-icon" aria-hidden="true">⚠</span>{{ t('pi.alerts') }}</span>
      <span class="badge badge-danger">{{ alerts.length }}</span>
    </div>
    <div class="panel-body">
      <ul class="list alert-list">
        <li v-for="(alert, index) in alerts" :key="`${alert.at}|${alert.code}|${alert.port}|${index}`">
          <div class="list-item-main">
            <span class="name">{{ alertTitle(alert) }}<template v-if="alert.port"> · <span class="mono">{{ alert.port }}</span></template></span>
            <span v-if="alert.message" class="alert-message">{{ alert.message }}</span>
            <span class="meta" :title="formatDate(alert.at, locale)">{{ formatAgo(alert.at, now) }}</span>
          </div>
          <div v-if="unlockable.has(index) && alert.port" class="list-item-actions">
            <button type="button" class="btn btn-sm btn-primary" :disabled="busy" @click="emit('unlock', alert.port)">{{ t('pi.unlock') }}</button>
          </div>
        </li>
      </ul>
      <button type="button" class="btn btn-block" :disabled="busy" @click="emit('clear')">{{ t('pi.alertsClear') }}</button>
    </div>
  </section>
</template>
