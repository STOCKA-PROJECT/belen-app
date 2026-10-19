<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { StockaApiError } from '../api/stocka'
import { stockaErrorMessage } from '../errorMessages'
import { useI18n } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { downloadKey, useLibraryStore } from '../stores/library'
import { useUiStore } from '../stores/ui'
import type { Organization, ShowIssue, Timeline } from '../types'
import { formatBytes, formatDate, percent } from '../util/format'

const auth = useAuthStore()
const library = useLibraryStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const { t, locale } = useI18n()

const slug = computed(() => String(route.params.slug ?? ''))
const organization = ref<Organization | null>(null)
const timelines = ref<Timeline[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const issuesByTimeline = ref<Record<number, { message: string; issues: ShowIssue[] }>>({})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [orgs, list] = await Promise.all([auth.client.listOrganizations(), auth.client.listTimelines(slug.value)])
    organization.value = orgs.find((o) => o.slug === slug.value) ?? { id: 0, name: slug.value, slug: slug.value, currentUserRole: null }
    timelines.value = list
  } catch (err) {
    if (auth.handleApiError(err)) {
      await router.replace({ path: '/login', query: { redirect: route.fullPath } })
      return
    }
    error.value = stockaErrorMessage(err)
  } finally {
    loading.value = false
  }
}

function progressOf(timeline: Timeline) {
  return library.downloads[downloadKey(slug.value, timeline.id)]
}

function entryOf(timeline: Timeline) {
  return library.findByTimeline(slug.value, timeline.id)
}

async function download(timeline: Timeline): Promise<void> {
  const org = organization.value
  if (!org) return
  delete issuesByTimeline.value[timeline.id]
  try {
    await library.download(auth.client, org, timeline)
    ui.toast(t('timelines.saved'))
  } catch (err) {
    if (auth.handleApiError(err)) {
      await router.replace({ path: '/login', query: { redirect: route.fullPath } })
      return
    }
    const message = stockaErrorMessage(err)
    const issues = err instanceof StockaApiError ? [...err.issues, ...err.warnings] : []
    issuesByTimeline.value[timeline.id] = { message, issues }
    if (!issues.length) ui.toast(message, true)
  }
}

onMounted(load)
</script>

<template>
  <div class="view">
    <div v-if="!ui.online" class="notice notice-warn">{{ t('app.offline') }}</div>
    <div class="row-between">
      <div class="row grow">
        <router-link class="btn btn-sm btn-quiet" to="/orgs">‹ {{ t('orgs.title') }}</router-link>
        <h2 class="truncate">{{ organization?.name ?? slug }}</h2>
      </div>
      <button type="button" class="btn btn-sm" :disabled="loading" @click="load">{{ t('common.refresh') }}</button>
    </div>
    <p v-if="error" class="notice notice-danger">{{ error }}</p>

    <section class="panel">
      <p v-if="loading && !timelines.length" class="empty">{{ t('common.loading') }}</p>
      <ul v-else-if="timelines.length" class="list">
        <li v-for="tl in timelines" :key="tl.id" style="flex-direction: column; align-items: stretch">
          <div class="row-between">
            <div class="list-item-main">
              <span class="name">{{ tl.name }}</span>
              <span class="meta">{{ t('timelines.updatedAt', { date: formatDate(tl.updatedAt ?? tl.createdAt, locale) }) }}</span>
              <span v-if="entryOf(tl)" class="row-wrap">
                <span class="badge badge-ok">{{ t('timelines.inLibrary') }}</span>
                <span class="meta">{{ formatBytes(entryOf(tl)?.size) }}</span>
              </span>
            </div>
            <div class="list-item-actions">
              <button
                type="button"
                class="btn"
                :class="entryOf(tl) ? '' : 'btn-primary'"
                :disabled="!ui.online || progressOf(tl)?.phase === 'preparing' || progressOf(tl)?.phase === 'downloading'"
                @click="download(tl)"
              >
                {{ entryOf(tl) ? t('timelines.redownload') : t('timelines.download') }}
              </button>
            </div>
          </div>
          <template v-if="progressOf(tl)?.phase === 'preparing' || progressOf(tl)?.phase === 'downloading'">
            <p class="small muted" style="margin-top: 8px">
              <template v-if="progressOf(tl)?.phase === 'preparing'">{{ t('timelines.preparing') }}</template>
              <template v-else-if="progressOf(tl)?.total">{{ t('timelines.downloading', { percent: percent(progressOf(tl)?.received ?? 0, progressOf(tl)?.total) }) }}</template>
              <template v-else>{{ t('timelines.downloadingBytes', { bytes: formatBytes(progressOf(tl)?.received) }) }}</template>
            </p>
            <div class="progress" style="margin-top: 4px">
              <span :style="{ width: `${progressOf(tl)?.total ? percent(progressOf(tl)?.received ?? 0, progressOf(tl)?.total) : 100}%` }" />
            </div>
          </template>
          <div v-if="issuesByTimeline[tl.id]" class="notice notice-danger" style="margin-top: 8px">
            {{ issuesByTimeline[tl.id]?.message }}
            <ul v-if="issuesByTimeline[tl.id]?.issues.length">
              <li v-for="(issue, i) in issuesByTimeline[tl.id]?.issues" :key="i" :class="issue.level === 'warning' ? 'text-warn' : ''">
                <span class="mono">{{ issue.code }}</span> {{ issue.message }}
              </li>
            </ul>
          </div>
        </li>
      </ul>
      <p v-else-if="!loading" class="empty">{{ t('timelines.empty') }}</p>
    </section>
  </div>
</template>
