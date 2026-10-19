<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { useI18n } from '../i18n'
import { useLibraryStore } from '../stores/library'
import { usePiStore } from '../stores/pi'
import type { LibraryEntry } from '../types'
import { hash8 } from '../util/bundleName'
import { formatBytes, formatDate } from '../util/format'

const library = useLibraryStore()
const pi = usePiStore()
const router = useRouter()
const { t, locale } = useI18n()

const piHashes = computed(() => new Set((pi.bundles?.shows ?? []).map((s) => s.hash)))
const activeHash = computed(() => pi.bundles?.active ?? pi.status?.showHash ?? null)

async function remove(entry: LibraryEntry): Promise<void> {
  if (!window.confirm(t('library.confirmDelete', { name: entry.name }))) return
  await library.remove(entry.fileName)
}

async function send(entry: LibraryEntry): Promise<void> {
  await router.push({ path: '/pi', query: { send: entry.fileName } })
}
</script>

<template>
  <div class="view">
    <div class="row-between">
      <h2>{{ t('library.title') }}</h2>
      <span class="muted small">{{ t('library.count', { count: library.count }) }}</span>
    </div>
    <section class="panel">
      <ul v-if="library.sorted.length" class="list">
        <li v-for="entry in library.sorted" :key="entry.fileName" style="flex-direction: column; align-items: stretch">
          <div class="row-between">
            <div class="list-item-main">
              <span class="name">{{ entry.name }}</span>
              <span class="meta">{{ entry.orgName }} · {{ formatBytes(entry.size) }} · <span class="mono">{{ hash8(entry.hash) }}</span></span>
              <span class="meta">{{ t('library.downloadedAt', { date: formatDate(entry.downloadedAt, locale) }) }}</span>
              <span class="row-wrap">
                <span v-if="activeHash === entry.hash" class="badge badge-brand">{{ t('library.activeOnPi') }}</span>
                <span v-else-if="piHashes.has(entry.hash)" class="badge badge-ok">{{ t('library.onPi') }}</span>
              </span>
            </div>
          </div>
          <div class="row" style="margin-top: 8px">
            <button type="button" class="btn btn-primary grow" @click="send(entry)">{{ t('library.send') }}</button>
            <button type="button" class="btn btn-danger" @click="remove(entry)">{{ t('common.delete') }}</button>
          </div>
        </li>
      </ul>
      <p v-else class="empty">{{ t('library.empty') }}</p>
    </section>
  </div>
</template>
