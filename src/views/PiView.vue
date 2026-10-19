<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BundleList from '../components/BundleList.vue'
import PinDialog from '../components/PinDialog.vue'
import PortSwitches from '../components/PortSwitches.vue'
import StatusCard from '../components/StatusCard.vue'
import UploadProgress from '../components/UploadProgress.vue'
import { useI18n } from '../i18n'
import { useLibraryStore } from '../stores/library'
import { usePiStore } from '../stores/pi'
import type { LibraryEntry } from '../types'
import { hash8 } from '../util/bundleName'
import { formatBytes } from '../util/format'

const pi = usePiStore()
const library = useLibraryStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const urlInput = ref(pi.baseUrl)
const showLogs = ref(false)
const libraryHashes = computed(() => new Set(library.entries.map((e) => e.hash)))
const piHashes = computed(() => new Set((pi.bundles?.shows ?? []).map((s) => s.hash)))
const netEnabled = computed(() => pi.net && pi.net.enabled !== false)
const pendingSend = ref<string | null>(null)

async function connect(url?: string): Promise<void> {
  if (url) urlInput.value = url
  const ok = await pi.connect(urlInput.value)
  if (ok) urlInput.value = pi.baseUrl
}

function confirmThen(message: string, action: () => Promise<void>): void {
  if (window.confirm(message)) void action()
}

async function send(entry: LibraryEntry): Promise<void> {
  if (!pi.connected) {
    pendingSend.value = entry.fileName
    return
  }
  pendingSend.value = null
  await pi.sendBundle(entry)
}

async function retryUpload(): Promise<void> {
  const fileName = pi.upload?.fileName
  const entry = fileName ? library.findByFileName(fileName) : undefined
  if (entry) await pi.sendBundle(entry)
}

async function toggleLogs(): Promise<void> {
  showLogs.value = !showLogs.value
  if (showLogs.value) await pi.guarded(() => pi.refreshLogs())
}

watch(
  () => pi.connected,
  async (connected) => {
    if (connected && pendingSend.value) {
      const entry = library.findByFileName(pendingSend.value)
      pendingSend.value = null
      if (entry) await pi.sendBundle(entry)
    }
  },
)

onMounted(async () => {
  const send = typeof route.query.send === 'string' ? route.query.send : null
  if (send) {
    pendingSend.value = send
    await router.replace({ path: '/pi' })
  }
  if (!pi.connected) {
    const ok = await pi.connect()
    if (!ok && pi.lastGoodUrl && pi.lastGoodUrl !== pi.baseUrl) await connect(pi.lastGoodUrl)
  } else if (pendingSend.value) {
    const entry = library.findByFileName(pendingSend.value)
    pendingSend.value = null
    if (entry) await pi.sendBundle(entry)
  }
})

onBeforeUnmount(() => {
  /* keep the subscription alive: the status is cheap and the user comes back to this tab */
})
</script>

<template>
  <div class="view">
    <!-- Connexió -->
    <section class="panel">
      <div class="panel-title">
        <span>{{ t('pi.connection') }}</span>
        <span class="badge" :class="pi.connected ? 'badge-ok' : pi.connecting ? 'badge-warn' : 'badge-danger'">
          {{ pi.connected ? t('pi.connected') : pi.connecting ? t('pi.connecting') : t('pi.disconnected') }}
        </span>
      </div>
      <form class="panel-body" @submit.prevent="connect()">
        <label class="field-group">
          <span class="label">{{ t('pi.url') }}</span>
          <input v-model="urlInput" class="field mono" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" />
        </label>
        <div class="row-wrap">
          <button v-for="c in pi.candidates" :key="c" type="button" class="btn btn-sm" :disabled="pi.connecting" @click="connect(c)">{{ c.replace(/^https?:\/\//, '') }}</button>
        </div>
        <p class="small muted">{{ t('pi.urlHint') }}</p>
        <p v-if="pi.connectionError && !pi.connected" class="notice notice-danger">{{ t('pi.unreachable', { url: pi.baseUrl }) }}</p>
        <div class="row">
          <button type="submit" class="btn btn-primary grow" :disabled="pi.connecting">{{ pi.connecting ? t('pi.connecting') : t('pi.connect') }}</button>
          <button type="button" class="btn" @click="pi.openPinDialog()">{{ pi.pin ? t('pi.pinChange') : t('pi.pinEnter') }}</button>
        </div>
        <p class="small" :class="pi.pin ? 'text-ok' : 'muted'">{{ pi.pin ? t('pi.pinSaved') : t('pi.pinMissing') }}<template v-if="pi.pin && pi.name"> · {{ pi.name }}</template></p>
        <div v-if="pi.info" class="kpi">
          <div>
            <span class="label">{{ t('pi.device') }}</span>
            <span class="value">{{ pi.info.device.name }}</span>
          </div>
          <div>
            <span class="label">{{ t('pi.version') }}</span>
            <span class="value">{{ pi.info.version }}<template v-if="pi.info.simulate"> · {{ t('pi.simulated') }}</template></span>
          </div>
        </div>
      </form>
    </section>

    <template v-if="pi.connected">
      <StatusCard :status="pi.status" :info="pi.info" />

      <!-- Mandos -->
      <section class="panel">
        <div class="panel-body">
          <div class="row">
            <button type="button" class="btn btn-primary btn-lg grow" :disabled="pi.busy || pi.playing || !pi.status?.showHash" @click="pi.play()">▶ {{ t('pi.play') }}</button>
            <button type="button" class="btn btn-lg grow" :disabled="pi.busy || !pi.playing" @click="pi.stop()">■ {{ t('pi.stop') }}</button>
          </div>
          <button type="button" class="btn btn-danger-solid btn-lg btn-block" :disabled="pi.busy" @click="confirmThen(t('pi.confirmPanic'), () => pi.panic())">{{ t('pi.panic') }}</button>
        </div>
      </section>

      <PortSwitches :hardware="pi.hardware" :busy="pi.busy" @toggle="pi.toggleOverride($event)" @clear="pi.clearOverrides()" />

      <!-- Enviar des de la biblioteca -->
      <section class="panel">
        <div class="panel-title"><span>{{ t('pi.send') }}</span></div>
        <div class="panel-body">
          <UploadProgress v-if="pi.upload" :upload="pi.upload" @cancel="pi.cancelUpload()" @retry="retryUpload" @dismiss="pi.dismissUpload()" />
          <template v-else>
            <p class="small muted">{{ t('pi.sendHint') }}</p>
            <label class="switch">
              <input v-model="pi.activateAfterUpload" type="checkbox" />
              <span>{{ t('pi.activateAfter') }}</span>
            </label>
            <ul v-if="library.sorted.length" class="list">
              <li v-for="entry in library.sorted" :key="entry.fileName">
                <div class="list-item-main">
                  <span class="name truncate">{{ entry.name }}</span>
                  <span class="meta">{{ formatBytes(entry.size) }} · <span class="mono">{{ hash8(entry.hash) }}</span></span>
                  <span v-if="piHashes.has(entry.hash)" class="badge badge-ok">{{ t('pi.alreadyOnPi') }}</span>
                </div>
                <div class="list-item-actions">
                  <button type="button" class="btn btn-sm btn-primary" :disabled="pi.busy" @click="send(entry)">{{ t('common.send') }}</button>
                </div>
              </li>
            </ul>
            <p v-else class="empty">{{ t('pi.libraryEmpty') }}</p>
          </template>
        </div>
      </section>

      <BundleList
        :bundles="pi.bundles"
        :busy="pi.busy"
        :library-hashes="libraryHashes"
        @activate="pi.activate($event)"
        @remove="(hash) => confirmThen(t('pi.confirmDelete'), () => pi.deleteBundle(hash))"
        @rollback="pi.rollback()"
      />

      <!-- Xarxa i sistema -->
      <section class="panel">
        <div class="panel-title"><span>{{ t('pi.net') }}</span></div>
        <div class="panel-body">
          <template v-if="netEnabled && pi.net">
            <div class="kpi">
              <div>
                <span class="label">{{ t('pi.netMode') }}</span>
                <span class="value">{{ pi.net.mode === 'ap' ? t('pi.netAp') : t('pi.netAuto') }}</span>
              </div>
              <div>
                <span class="label">{{ t('pi.netSsid') }}</span>
                <span class="value">{{ pi.net.hotspot ? `${pi.net.ssid} · ${t('pi.netHotspotActive')}` : pi.net.ssid || t('pi.netDisconnected') }}</span>
              </div>
              <div>
                <span class="label">{{ t('pi.netIp') }}</span>
                <span class="value mono">{{ pi.net.ip || '—' }}</span>
              </div>
            </div>
            <div class="row-wrap">
              <button type="button" class="btn btn-sm" :disabled="pi.busy || pi.net.mode === 'ap'" @click="confirmThen(t('pi.confirmNetMode'), () => pi.setNetMode('ap'))">{{ t('pi.netAp') }}</button>
              <button type="button" class="btn btn-sm" :disabled="pi.busy || pi.net.mode === 'auto'" @click="confirmThen(t('pi.confirmNetMode'), () => pi.setNetMode('auto'))">{{ t('pi.netAuto') }}</button>
              <button type="button" class="btn btn-sm" :disabled="pi.busy" @click="confirmThen(t('pi.confirmHotspot', { ssid: pi.info?.device.apSsid ?? 'belen' }), () => pi.hotspotNow())">{{ t('pi.netHotspotNow') }}</button>
            </div>
          </template>
          <p v-else class="small muted">{{ t('pi.netDisabled') }}</p>
        </div>
      </section>

      <section class="panel">
        <div class="panel-title">
          <span>{{ t('pi.system') }}</span>
          <button type="button" class="btn btn-sm" @click="toggleLogs">{{ t('pi.logs') }}</button>
        </div>
        <div class="panel-body">
          <template v-if="showLogs">
            <div class="row-between">
              <span class="label">{{ t('pi.logs') }}</span>
              <button type="button" class="btn btn-sm" @click="pi.guarded(() => pi.refreshLogs())">{{ t('common.refresh') }}</button>
            </div>
            <pre v-if="pi.logs.length" class="logs">{{ pi.logs.join('\n') }}</pre>
            <p v-else class="small muted">{{ t('pi.logsEmpty') }}</p>
          </template>
          <button type="button" class="btn btn-danger btn-block" :disabled="pi.busy" @click="confirmThen(t('pi.confirmReboot'), () => pi.reboot())">{{ t('pi.reboot') }}</button>
        </div>
      </section>
    </template>

    <PinDialog :open="pi.pinDialogOpen" :error="pi.pinError" :initial-name="pi.name" @submit="(p, n) => pi.submitPin(p, n)" @cancel="pi.cancelPinDialog()" />
  </div>
</template>
