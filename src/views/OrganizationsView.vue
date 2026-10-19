<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { stockaErrorMessage } from '../errorMessages'
import { useI18n } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { useUiStore } from '../stores/ui'
import type { Organization } from '../types'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const { t } = useI18n()

const organizations = ref<Organization[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    organizations.value = await auth.client.listOrganizations()
  } catch (err) {
    if (auth.handleApiError(err)) {
      await router.replace({ path: '/login', query: { redirect: '/orgs' } })
      return
    }
    error.value = stockaErrorMessage(err)
  } finally {
    loading.value = false
  }
}

function roleLabel(role: Organization['currentUserRole']): string {
  switch (role) {
    case 'OWNER':
      return t('orgs.role.OWNER')
    case 'MANAGER':
      return t('orgs.role.MANAGER')
    case 'USER':
      return t('orgs.role.USER')
    case 'SPECTATOR':
      return t('orgs.role.SPECTATOR')
    default:
      return ''
  }
}

onMounted(load)
</script>

<template>
  <div class="view">
    <div v-if="!ui.online" class="notice notice-warn">{{ t('app.offline') }}</div>
    <div class="row-between">
      <h2>{{ t('orgs.title') }}</h2>
      <div class="row">
        <button type="button" class="btn btn-sm" :disabled="loading" @click="load">{{ t('common.refresh') }}</button>
        <button type="button" class="btn btn-sm btn-quiet" @click="auth.logout().then(() => router.replace('/login'))">{{ t('login.logout') }}</button>
      </div>
    </div>
    <p v-if="error" class="notice notice-danger">{{ error }}</p>
    <section class="panel">
      <p v-if="loading && !organizations.length" class="empty">{{ t('common.loading') }}</p>
      <ul v-else-if="organizations.length" class="list">
        <li v-for="org in organizations" :key="org.id">
          <router-link class="list-item-main" :to="`/orgs/${encodeURIComponent(org.slug)}/timelines`" style="text-decoration: none; color: inherit">
            <span class="name">{{ org.name }}</span>
            <span class="meta">{{ org.slug }}</span>
          </router-link>
          <span v-if="org.currentUserRole" class="badge" :class="org.currentUserRole === 'SPECTATOR' ? '' : 'badge-brand'">{{ roleLabel(org.currentUserRole) }}</span>
        </li>
      </ul>
      <p v-else-if="!loading" class="empty">{{ t('orgs.empty') }}</p>
    </section>
  </div>
</template>
