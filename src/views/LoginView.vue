<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { stockaErrorMessage } from '../errorMessages'
import { useI18n } from '../i18n'
import { useAuthStore } from '../stores/auth'
import { useUiStore } from '../stores/ui'

const auth = useAuthStore()
const ui = useUiStore()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const email = ref(auth.lastEmail)
const password = ref('')
const code = ref('')
const serverUrl = ref(auth.baseUrl)
const showServer = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

const challenge = computed(() => !!auth.mfaToken)
const redirectTo = computed(() => (typeof route.query.redirect === 'string' ? route.query.redirect : '/orgs'))

async function submitCredentials(): Promise<void> {
  error.value = null
  busy.value = true
  try {
    if (showServer.value) auth.setBaseUrl(serverUrl.value)
    const result = await auth.login(email.value.trim(), password.value)
    password.value = ''
    if (result === 'ok') await router.replace(redirectTo.value)
  } catch (err) {
    error.value = stockaErrorMessage(err)
  } finally {
    busy.value = false
  }
}

async function submitCode(): Promise<void> {
  error.value = null
  busy.value = true
  try {
    await auth.submitTwoFactor(code.value.trim())
    code.value = ''
    await router.replace(redirectTo.value)
  } catch (err) {
    error.value = stockaErrorMessage(err)
  } finally {
    busy.value = false
  }
}

function back(): void {
  auth.cancelTwoFactor()
  error.value = null
}

async function logout(): Promise<void> {
  await auth.logout()
}
</script>

<template>
  <div class="view">
    <div v-if="!ui.online" class="notice notice-warn">{{ t('login.offline') }}</div>

    <section v-if="auth.isAuthenticated" class="panel">
      <div class="panel-body">
        <p>{{ t('login.loggedAs', { email: auth.user?.email ?? '' }) }}</p>
        <div class="row">
          <router-link class="btn btn-primary grow" to="/orgs">{{ t('orgs.title') }}</router-link>
          <button type="button" class="btn" @click="logout">{{ t('login.logout') }}</button>
        </div>
      </div>
    </section>

    <form v-else-if="!challenge" class="panel" @submit.prevent="submitCredentials">
      <div class="panel-body">
        <h2>{{ t('login.title') }}</h2>
        <div v-if="auth.sessionExpired" class="notice notice-info">{{ t('login.expired') }}</div>
        <label class="field-group">
          <span class="label">{{ t('login.email') }}</span>
          <input v-model="email" class="field" type="email" autocomplete="username" inputmode="email" required />
        </label>
        <label class="field-group">
          <span class="label">{{ t('login.password') }}</span>
          <input v-model="password" class="field" type="password" autocomplete="current-password" required />
        </label>
        <details class="details" :open="showServer" @toggle="showServer = ($event.target as HTMLDetailsElement).open">
          <summary class="small muted">{{ t('login.server') }}: <span class="mono">{{ auth.baseUrl }}</span></summary>
          <input v-model="serverUrl" class="field mono" type="text" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" />
        </details>
        <p v-if="error" class="notice notice-danger">{{ error }}</p>
        <button type="submit" class="btn btn-primary btn-lg" :disabled="busy || !ui.online">{{ busy ? t('login.busy') : t('login.submit') }}</button>
        <p class="small muted">{{ t('login.sessionNote') }}</p>
      </div>
    </form>

    <form v-else class="panel" @submit.prevent="submitCode">
      <div class="panel-body">
        <h2>{{ t('login.twofactor.title') }}</h2>
        <p class="small muted">{{ t('login.twofactor.hint') }}</p>
        <label class="field-group">
          <span class="label">{{ t('login.twofactor.code') }}</span>
          <input v-model="code" class="field field-code" type="text" inputmode="numeric" autocomplete="one-time-code" autofocus required />
        </label>
        <p v-if="error" class="notice notice-danger">{{ error }}</p>
        <div class="row">
          <button type="button" class="btn grow" :disabled="busy" @click="back">{{ t('common.back') }}</button>
          <button type="submit" class="btn btn-primary grow" :disabled="busy || !code.trim()">{{ t('login.twofactor.submit') }}</button>
        </div>
      </div>
    </form>
  </div>
</template>
