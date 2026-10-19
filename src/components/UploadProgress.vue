<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../i18n'
import type { UploadProgressState } from '../stores/pi'
import { hash8 } from '../util/bundleName'
import { formatBytes, percent } from '../util/format'

const props = defineProps<{ upload: UploadProgressState }>()
const emit = defineEmits<{ cancel: []; retry: []; dismiss: [] }>()
const { t } = useI18n()

const pct = computed(() => percent(props.upload.sent, props.upload.total))
const inFlight = computed(() => props.upload.phase === 'uploading' || props.upload.phase === 'verifying')
const report = computed(() => props.upload.report)
const ok = computed(() => props.upload.phase === 'done' && report.value?.ok === true)
</script>

<template>
  <div class="stack">
    <template v-if="inFlight">
      <p v-if="upload.phase === 'uploading'">{{ t('pi.uploading', { name: upload.name, percent: pct }) }}</p>
      <p v-else>{{ t('pi.verifying') }}</p>
      <div class="progress"><span :style="{ width: `${upload.phase === 'verifying' ? 100 : pct}%` }" /></div>
      <div class="row-between">
        <span class="small muted">{{ formatBytes(upload.sent) }} / {{ formatBytes(upload.total) }}</span>
        <button type="button" class="btn btn-sm" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      </div>
    </template>

    <template v-else-if="upload.phase === 'error'">
      <div class="notice notice-danger">{{ t('pi.uploadFailed', { message: upload.error ?? '' }) }}</div>
      <div class="row">
        <button type="button" class="btn btn-primary" @click="emit('retry')">{{ t('common.retry') }}</button>
        <button type="button" class="btn" @click="emit('dismiss')">{{ t('common.close') }}</button>
      </div>
    </template>

    <template v-else-if="report">
      <div class="notice" :class="ok ? 'notice-ok' : 'notice-danger'">
        <strong>{{ ok ? t('pi.importOk') : t('pi.importRejected') }}<template v-if="ok && report.activated">{{ ' ' + t('pi.importActivated') }}</template></strong>
        <template v-if="report.name"> · {{ report.name }}</template>
        <template v-if="report.hash"> · <span class="mono">{{ hash8(report.hash) }}</span></template>
        <ul v-if="report.errors.length || report.warnings.length || report.skipped.length">
          <li v-for="(e, i) in report.errors" :key="`e${i}`" class="text-danger">{{ e.code }}: {{ e.message }}</li>
          <li v-for="(w, i) in report.warnings" :key="`w${i}`" class="text-warn">{{ w.code }}: {{ w.message }}</li>
          <li v-for="(s, i) in report.skipped" :key="`s${i}`" class="muted">{{ s }} ({{ t('pi.importSkipped') }})</li>
        </ul>
      </div>
      <button type="button" class="btn" @click="emit('dismiss')">{{ t('common.close') }}</button>
    </template>
  </div>
</template>
