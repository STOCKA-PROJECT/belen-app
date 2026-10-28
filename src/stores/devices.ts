import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { StockaApiError, type StockaClient } from '../api/stocka'
import { getKv, KEYS } from '../storage'
import { readJson, writeJson } from '../storage/kv'
import type { SavedDevice } from '../types'

interface DevicesIndex {
  devices: SavedDevice[]
  fetchedAt: string | null
}

function isSaved(value: unknown): value is SavedDevice {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'number' && typeof v.name === 'string' && typeof v.orgSlug === 'string'
}

/**
 * The players registered in Stocka, with their address and PIN, so the app connects without
 * typing. Loaded with the session whenever the phone has Internet (opening the app, logging in,
 * the network coming back) and kept in Preferences: at the belén there is no Internet, and that is
 * where the list is needed. Organizations without the hardware feature answer 403 and are skipped.
 */
export const useDevicesStore = defineStore('devices', () => {
  const devices = ref<SavedDevice[]>([])
  const fetchedAt = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let loaded = false

  const sorted = computed(() => [...devices.value].sort((a, b) => a.orgName.localeCompare(b.orgName) || a.name.localeCompare(b.name)))
  /** Devices the app can connect to: those with an address saved in Stocka. */
  const connectable = computed(() => sorted.value.filter((d) => !!d.localUrl))

  async function init(): Promise<void> {
    if (loaded) return
    const saved = await readJson<DevicesIndex>(getKv(), KEYS.devices)
    if (saved && Array.isArray(saved.devices)) {
      devices.value = saved.devices.filter(isSaved)
      fetchedAt.value = typeof saved.fetchedAt === 'string' ? saved.fetchedAt : null
    }
    loaded = true
  }

  async function persist(): Promise<void> {
    await writeJson(getKv(), KEYS.devices, { devices: devices.value, fetchedAt: fetchedAt.value } satisfies DevicesIndex)
  }

  /**
   * Reloads the devices of every organization of the user. Keeps the saved list when Stocka
   * cannot be reached; a session problem is left to the caller (`auth.handleApiError`).
   *
   * @returns whether the list was refreshed
   */
  async function refresh(stocka: StockaClient): Promise<boolean> {
    if (loading.value) return false
    loading.value = true
    error.value = null
    try {
      const orgs = await stocka.listOrganizations()
      const next: SavedDevice[] = []
      for (const org of orgs) {
        try {
          const list = await stocka.listDevices(org.slug)
          next.push(...list.map((d) => ({ ...d, orgSlug: org.slug, orgName: org.name })))
        } catch (err) {
          if (err instanceof StockaApiError && err.status === 403) continue // no hardware feature
          throw err
        }
      }
      devices.value = next
      fetchedAt.value = new Date().toISOString()
      await persist()
      return true
    } catch (err) {
      if (err instanceof StockaApiError && err.isAuthError) throw err
      error.value = err instanceof Error ? err.message : String(err)
      return false
    } finally {
      loading.value = false
    }
  }

  /** Forgets the list (on logout: the PINs in it belong to the session). */
  async function clear(): Promise<void> {
    devices.value = []
    fetchedAt.value = null
    await persist()
  }

  /**
   * The saved device the connected Pi corresponds to, if any: by the uuid the Pi reports (its
   * identity; two belenes may both be `belen.local`), else by address.
   */
  function find(baseUrl: string | null, deviceId: string | null): SavedDevice | undefined {
    const url = baseUrl?.replace(/\/+$/, '')
    const byUuid = deviceId ? devices.value.find((d) => d.deviceId === deviceId) : undefined
    return byUuid ?? (url ? devices.value.find((d) => d.localUrl?.replace(/\/+$/, '') === url) : undefined)
  }

  return { devices, sorted, connectable, fetchedAt, loading, error, init, refresh, clear, find }
})
