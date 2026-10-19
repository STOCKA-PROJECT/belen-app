import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { StockaApiError, StockaClient } from '../api/stocka'
import { DEFAULT_STOCKA_URL } from '../config'
import { locale } from '../i18n'
import { getKv, KEYS } from '../storage'
import { readJson, writeJson } from '../storage/kv'
import type { StockaSession, StockaUser } from '../types'
import { normalizeBaseUrl } from '../util/url'

interface SavedSession {
  baseUrl: string
  accessToken: string | null
  expiresAt: number | null
  user: StockaUser | null
  lastEmail: string
}

/**
 * Stocka session. The access token (15 min server-side) is kept in Preferences; when it expires
 * the user logs in again. The backend refreshes through an httpOnly `SameSite=Lax` cookie scoped
 * to `/auth` behind a CORS policy without credentials, which a native app cannot use, so there is
 * deliberately no refresh here.
 */
export const useAuthStore = defineStore('auth', () => {
  const baseUrl = ref(DEFAULT_STOCKA_URL)
  const accessToken = ref<string | null>(null)
  const expiresAt = ref<number | null>(null)
  const user = ref<StockaUser | null>(null)
  const lastEmail = ref('')
  const mfaToken = ref<string | null>(null)
  const sessionExpired = ref(false)
  const ready = ref(false)

  const isAuthenticated = computed(() => !!accessToken.value && (expiresAt.value ?? 0) > Date.now())

  const client = computed(
    () =>
      new StockaClient({
        baseUrl: baseUrl.value,
        getToken: () => (isAuthenticated.value ? accessToken.value : null),
        getLocale: () => locale.value,
      }),
  )

  async function init(): Promise<void> {
    const saved = await readJson<SavedSession>(getKv(), KEYS.session)
    if (saved) {
      if (saved.baseUrl) baseUrl.value = saved.baseUrl
      accessToken.value = saved.accessToken
      expiresAt.value = saved.expiresAt
      user.value = saved.user
      lastEmail.value = saved.lastEmail ?? ''
      if (accessToken.value && !isAuthenticated.value) {
        accessToken.value = null
        sessionExpired.value = true
      }
    }
    ready.value = true
  }

  async function persist(): Promise<void> {
    const saved: SavedSession = {
      baseUrl: baseUrl.value,
      accessToken: accessToken.value,
      expiresAt: expiresAt.value,
      user: user.value,
      lastEmail: lastEmail.value,
    }
    await writeJson(getKv(), KEYS.session, saved)
  }

  function setBaseUrl(url: string): void {
    const normalized = normalizeBaseUrl(url) || DEFAULT_STOCKA_URL
    if (normalized !== baseUrl.value) {
      baseUrl.value = normalized
      clearSession()
    }
    void persist()
  }

  function setSession(session: StockaSession): void {
    accessToken.value = session.accessToken
    expiresAt.value = Date.now() + session.expiresIn
    user.value = session.user
    mfaToken.value = null
    sessionExpired.value = false
    void persist()
  }

  /** First login step. Resolves to `'challenge'` when the account has 2FA and a code is needed. */
  async function login(email: string, password: string): Promise<'ok' | 'challenge'> {
    lastEmail.value = email
    const result = await client.value.login(email, password)
    if (result.kind === 'challenge') {
      mfaToken.value = result.mfaToken
      await persist()
      return 'challenge'
    }
    setSession(result.session)
    return 'ok'
  }

  /** Second login step with the TOTP or recovery code. */
  async function submitTwoFactor(code: string): Promise<void> {
    if (!mfaToken.value) throw new StockaApiError(401, 'auth.2fa_mfa_token_expired', 'No challenge in progress')
    try {
      setSession(await client.value.loginTwoFactor(mfaToken.value, code))
    } catch (err) {
      if (err instanceof StockaApiError && err.code === 'auth.2fa_mfa_token_expired') mfaToken.value = null
      throw err
    }
  }

  function cancelTwoFactor(): void {
    mfaToken.value = null
  }

  async function logout(): Promise<void> {
    if (isAuthenticated.value) await client.value.logout()
    clearSession()
    sessionExpired.value = false
    await persist()
  }

  function clearSession(): void {
    accessToken.value = null
    expiresAt.value = null
    user.value = null
    mfaToken.value = null
  }

  /** Drops the session when the backend says the token is no longer valid. Returns whether it did. */
  function handleApiError(err: unknown): boolean {
    if (err instanceof StockaApiError && err.isAuthError) {
      clearSession()
      sessionExpired.value = true
      void persist()
      return true
    }
    return false
  }

  return {
    baseUrl,
    accessToken,
    expiresAt,
    user,
    lastEmail,
    mfaToken,
    sessionExpired,
    ready,
    isAuthenticated,
    client,
    init,
    setBaseUrl,
    login,
    submitTwoFactor,
    cancelTwoFactor,
    logout,
    clearSession,
    handleApiError,
  }
})
