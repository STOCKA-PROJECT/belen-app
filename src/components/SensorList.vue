<script setup lang="ts">
import { useI18n } from '../i18n'
import type { NamedSensor } from '../stores/pi'
import { sensorOnActiveLabel } from '../util/piLabels'

/** Live readings of the sensor ports; cutting them is done from the port list. */
defineProps<{ sensors: NamedSensor[] }>()
const { t } = useI18n()
</script>

<template>
  <section class="panel">
    <div class="panel-title"><span>{{ t('pi.sensors') }}</span></div>
    <div class="panel-body">
      <ul v-if="sensors.length" class="list sensor-list">
        <li v-for="sensor in sensors" :key="sensor.name" :class="{ 'is-off': sensor.blocked }">
          <span class="sensor-dot" :class="{ 'is-on': sensor.active }" role="img" :aria-label="sensor.active ? t('pi.sensorActive') : t('pi.sensorInactive')" />
          <div class="list-item-main">
            <span class="name truncate">{{ sensor.name }}</span>
            <span class="meta">
              <span class="mono">{{ sensor.address }}</span> · {{ sensorOnActiveLabel(sensor.onActive) }} ·
              <span :class="sensor.active ? 'text-ok' : ''">{{ sensor.active ? t('pi.sensorActive') : t('pi.sensorInactive') }}</span>
            </span>
          </div>
          <span v-if="sensor.blocked" class="badge badge-danger">{{ t('pi.cutBadge') }}</span>
        </li>
      </ul>
      <p v-else class="empty">{{ t('pi.sensorsNone') }}</p>
    </div>
  </section>
</template>
