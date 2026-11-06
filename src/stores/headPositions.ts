import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { StockaApiError, type StockaClient } from '../api/stocka'
import { getKv, KEYS } from '../storage'
import { readJson, writeJson } from '../storage/kv'
import type { HeadPosition, HeadProfile, StockaPort } from '../types'

interface HeadPortsCache {
  /** Moving head ports by organization slug, as last fetched. */
  byOrg: Record<string, StockaPort[]>
  profiles: Record<string, HeadProfile>
}

/** The positions declared in a port config, skipping anything that is not an object with a name. */
export function headPositionsOf(config: Record<string, unknown> | null | undefined): HeadPosition[] {
  const raw = config?.positions
  if (!Array.isArray(raw)) return []
  return raw.filter((p): p is HeadPosition => !!p && typeof p === 'object' && typeof (p as HeadPosition).name === 'string' && (p as HeadPosition).name.trim() !== '')
}

/** Whether two position names are the same for the backend (trimmed, case-insensitive). */
export function samePositionName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** The positions of a port with `position` added, or replacing the one with the same name. */
export function withPosition(existing: HeadPosition[], position: HeadPosition): HeadPosition[] {
  const index = existing.findIndex((p) => samePositionName(p.name, position.name))
  return index >= 0 ? existing.map((p, i) => (i === index ? position : p)) : [...existing, position]
}

/**
 * The moving heads of the organizations (their Stocka ports with the saved positions) and the
 * fixture profiles, so the Pi screen can move a head with sliders, send it to a saved position and
 * save where it points as a new position of its port. Fetched when the phone has Internet and kept
 * in Preferences: at the belén there is usually none, and the positions are still worth showing.
 * Saving needs Internet (it is a PATCH on the Stocka port).
 */
export const useHeadPositionsStore = defineStore('headPositions', () => {
  const byOrg = ref<Record<string, StockaPort[]>>({})
  const profiles = ref<Record<string, HeadProfile>>({})
  const loading = ref(false)
  let loaded = false

  async function init(): Promise<void> {
    if (loaded) return
    const saved = await readJson<HeadPortsCache>(getKv(), KEYS.headPorts)
    if (saved) {
      byOrg.value = saved.byOrg && typeof saved.byOrg === 'object' ? saved.byOrg : {}
      profiles.value = saved.profiles && typeof saved.profiles === 'object' ? saved.profiles : {}
    }
    loaded = true
  }

  async function persist(): Promise<void> {
    await writeJson(getKv(), KEYS.headPorts, { byOrg: byOrg.value, profiles: profiles.value } satisfies HeadPortsCache)
  }

  /** Head ports of an organization by name (the show's targets carry the port names). */
  const headsOf = computed(() => (orgSlug: string | null | undefined): Record<string, StockaPort> => {
    if (!orgSlug) return {}
    return Object.fromEntries((byOrg.value[orgSlug] ?? []).map((p) => [p.name, p]))
  })

  /** Profile of a head port (its `config.profile`), when the catalog is known. */
  function profileOf(port: StockaPort | undefined): HeadProfile | null {
    const id = port?.config.profile
    return typeof id === 'string' ? (profiles.value[id] ?? null) : null
  }

  /**
   * Reloads the heads of an organization (and the profiles once). Keeps what is cached when Stocka
   * cannot be reached; an organization without the feature (403) simply has none.
   *
   * @returns whether the list was refreshed
   */
  async function refresh(stocka: StockaClient, orgSlug: string): Promise<boolean> {
    if (loading.value) return false
    loading.value = true
    try {
      const ports = await stocka.listPorts(orgSlug)
      byOrg.value = { ...byOrg.value, [orgSlug]: ports.filter((p) => p.kind === 'moving_head') }
      if (Object.keys(profiles.value).length === 0) {
        try {
          profiles.value = await stocka.headProfiles()
        } catch {
          // The sliders fall back to the Varytec ranges.
        }
      }
      await persist()
      return true
    } catch (err) {
      if (err instanceof StockaApiError && err.status === 403) {
        byOrg.value = { ...byOrg.value, [orgSlug]: [] }
        await persist()
      }
      return false
    } finally {
      loading.value = false
    }
  }

  /**
   * Saves a position on a head port (replacing one with the same name) and updates the cache.
   *
   * @returns whether the position replaced an existing one
   * @throws StockaApiError when Stocka refuses it (no permission, invalid values, no Internet)
   */
  async function save(stocka: StockaClient, orgSlug: string, port: StockaPort, position: HeadPosition): Promise<boolean> {
    const existing = headPositionsOf(port.config)
    const replaced = existing.some((p) => samePositionName(p.name, position.name))
    const updated = await stocka.updatePortConfig(orgSlug, port.id, { ...port.config, positions: withPosition(existing, position) })
    byOrg.value = { ...byOrg.value, [orgSlug]: (byOrg.value[orgSlug] ?? []).map((p) => (p.id === updated.id ? updated : p)) }
    await persist()
    return replaced
  }

  /** Forgets everything (on logout). */
  async function clear(): Promise<void> {
    byOrg.value = {}
    profiles.value = {}
    await persist()
  }

  return { byOrg, profiles, loading, init, headsOf, profileOf, refresh, save, clear }
})
