<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../i18n'
import type { PiHardware } from '../types'

const props = defineProps<{ hardware: PiHardware[]; busy?: boolean }>()
const emit = defineEmits<{ toggle: [hw: PiHardware]; clear: [] }>()
const { t } = useI18n()

const cut = computed(() => props.hardware.filter((h) => h.off).length)
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
          </div>
          <div class="list-item-actions">
            <button
              type="button"
              class="btn"
              :class="hw.off ? 'btn-primary' : 'btn-danger-solid'"
              :disabled="busy"
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
