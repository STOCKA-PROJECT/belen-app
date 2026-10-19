import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { initI18n } from './i18n'
import { router } from './router'
import { getKv } from './storage'
import { useAuthStore } from './stores/auth'
import { useLibraryStore } from './stores/library'
import { usePiStore } from './stores/pi'
import './styles/app.css'

async function bootstrap(): Promise<void> {
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  await Promise.all([initI18n(getKv()), useAuthStore(pinia).init(), useLibraryStore(pinia).init(), usePiStore(pinia).init()])
  app.use(router)
  await router.isReady()
  app.mount('#app')
}

void bootstrap()
