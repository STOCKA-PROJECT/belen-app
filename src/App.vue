<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'

import { useI18n } from './i18n'
import { useAuthStore } from './stores/auth'
import { useUiStore } from './stores/ui'

const route = useRoute()
const ui = useUiStore()
const auth = useAuthStore()
const { t, otherLocale, toggleLocale } = useI18n()

const tab = computed(() => (route.meta.tab as string | undefined) ?? 'library')
const stockaTarget = computed(() => (auth.isAuthenticated ? '/orgs' : '/login'))

const onOnline = () => ui.setOnline(true)
const onOffline = () => ui.setOnline(false)
onMounted(() => {
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
})
onBeforeUnmount(() => {
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
})
</script>

<template>
  <div class="app">
    <header class="topbar">
      <span class="brand-dot" aria-hidden="true" />
      <h1>{{ t('app.title') }}</h1>
      <button type="button" class="btn btn-sm btn-quiet" :aria-label="otherLocale" @click="toggleLocale">{{ otherLocale.toUpperCase() }}</button>
    </header>

    <router-view />

    <nav class="tabbar" aria-label="Tabs">
      <router-link :to="stockaTarget" :class="{ active: tab === 'stocka' }"><span class="ico" aria-hidden="true">☁</span>{{ t('app.tab.stocka') }}</router-link>
      <router-link to="/library" :class="{ active: tab === 'library' }"><span class="ico" aria-hidden="true">▤</span>{{ t('app.tab.library') }}</router-link>
      <router-link to="/pi" :class="{ active: tab === 'pi' }"><span class="ico" aria-hidden="true">✶</span>{{ t('app.tab.pi') }}</router-link>
    </nav>

    <div class="toast-host" aria-live="polite">
      <div v-for="toast in ui.toasts" :key="toast.id" class="toast" :class="{ 'is-error': toast.error }" @click="ui.dismiss(toast.id)">{{ toast.message }}</div>
    </div>
  </div>
</template>
