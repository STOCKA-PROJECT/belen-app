<script setup lang="ts">
import { useI18n } from '../i18n'
import type { PiBundles } from '../types'
import { hash8 } from '../util/bundleName'
import { formatBytes, formatDate } from '../util/format'

defineProps<{ bundles: PiBundles | null; busy?: boolean; libraryHashes?: Set<string> }>()
const emit = defineEmits<{ activate: [hash: string]; remove: [hash: string]; rollback: [] }>()
const { t, locale } = useI18n()
</script>

<template>
  <section class="panel">
    <div class="panel-title">
      <span>{{ t('pi.bundles') }}</span>
      <button type="button" class="btn btn-sm" :disabled="busy || !bundles?.previous" @click="emit('rollback')">{{ t('pi.rollback') }}</button>
    </div>
    <ul v-if="bundles && bundles.shows.length" class="list">
      <li v-for="s in bundles.shows" :key="s.hash" :class="{ 'is-active': s.active }">
        <div class="list-item-main">
          <span class="name truncate">{{ s.name || hash8(s.hash) }}</span>
          <span class="meta">
            <span class="mono">{{ hash8(s.hash) }}</span> · {{ formatBytes(s.size) }} · {{ formatDate(s.importedAt, locale) }}
          </span>
          <span class="row-wrap">
            <span v-if="s.active" class="badge badge-brand">{{ t('common.active') }}</span>
            <span v-if="s.previous" class="badge">{{ t('common.previous') }}</span>
            <span v-if="libraryHashes?.has(s.hash)" class="badge badge-ok">{{ t('app.tab.library') }}</span>
          </span>
        </div>
        <div v-if="!s.active" class="list-item-actions">
          <button type="button" class="btn btn-sm btn-primary" :disabled="busy" @click="emit('activate', s.hash)">{{ t('common.activate') }}</button>
          <button v-if="!s.previous" type="button" class="btn btn-sm" :disabled="busy" @click="emit('remove', s.hash)">{{ t('common.delete') }}</button>
        </div>
      </li>
    </ul>
    <p v-else class="empty">{{ t('pi.noBundles') }}</p>
  </section>
</template>
