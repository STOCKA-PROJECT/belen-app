import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { StockaApiError, type StockaClient } from '../api/stocka'
import { KEYS, setStorage } from '../storage'
import { createMemoryBundleFiles } from '../storage/bundleFiles'
import { createMemoryKv } from '../storage/kv'
import type { StockaPort } from '../types'
import { headPositionsOf, samePositionName, useHeadPositionsStore, withPosition } from './headPositions'

const cap1: StockaPort = { id: 7, name: 'Cap1', kind: 'moving_head', config: { profile: 'varytec-hero-wash-712z', address: 1, positions: [{ name: 'Portal', pan: 212, tilt: 48 }] } }
const relay: StockaPort = { id: 8, name: 'Focos', kind: 'relay', config: {} }

function fakeStocka(ports: StockaPort[] | Error, profiles: Record<string, unknown> | Error = {}) {
  const calls: string[] = []
  const stocka = {
    async listPorts(slug: string) {
      calls.push(`ports:${slug}`)
      if (ports instanceof Error) throw ports
      return ports
    },
    async headProfiles() {
      calls.push('profiles')
      if (profiles instanceof Error) throw profiles
      return profiles
    },
    async updatePortConfig(slug: string, id: number, config: Record<string, unknown>) {
      calls.push(`patch:${slug}:${id}`)
      return { ...cap1, id, config }
    },
  }
  return { calls, stocka: stocka as unknown as StockaClient }
}

describe('head position helpers', () => {
  it('reads positions tolerating junk and matches names case-insensitively', () => {
    expect(headPositionsOf({ positions: [{ name: 'Portal', pan: 1 }, { name: ' ' }, 'x', null] })).toEqual([{ name: 'Portal', pan: 1 }])
    expect(headPositionsOf({})).toEqual([])
    expect(headPositionsOf(undefined)).toEqual([])
    expect(samePositionName(' portal', 'PORTAL ')).toBe(true)
  })

  it('withPosition replaces the position with the same name or appends', () => {
    const existing = [{ name: 'Portal', pan: 1 }, { name: 'Estrella', tilt: 2 }]
    expect(withPosition(existing, { name: 'portal', zoom: 6 })).toEqual([{ name: 'portal', zoom: 6 }, { name: 'Estrella', tilt: 2 }])
    expect(withPosition(existing, { name: 'Pastors', pan: 3 })).toEqual([...existing, { name: 'Pastors', pan: 3 }])
  })
})

describe('useHeadPositionsStore', () => {
  let kv: ReturnType<typeof createMemoryKv>

  beforeEach(() => {
    setActivePinia(createPinia())
    kv = createMemoryKv()
    setStorage({ kv, files: createMemoryBundleFiles() })
  })

  it('keeps only the heads of the organization, loads the profiles once and persists', async () => {
    const store = useHeadPositionsStore()
    await store.init()
    const { calls, stocka } = fakeStocka([cap1, relay], { 'varytec-hero-wash-712z': { pan: { max: 540 }, tilt: { max: 190 }, zoom: { min: 6, max: 36 } } })
    expect(await store.refresh(stocka, 'parroquia')).toBe(true)
    expect(store.headsOf('parroquia')).toEqual({ Cap1: cap1 })
    expect(store.headsOf('altra')).toEqual({})
    expect(store.profileOf(cap1)).toEqual({ pan: { max: 540 }, tilt: { max: 190 }, zoom: { min: 6, max: 36 } })
    expect(store.profileOf(relay)).toBeNull()
    await store.refresh(stocka, 'parroquia')
    expect(calls.filter((c) => c === 'profiles')).toHaveLength(1)
    expect(JSON.parse(kv.data.get(KEYS.headPorts)!).byOrg.parroquia).toHaveLength(1)
  })

  it('survives a restart from the cache and keeps it when Stocka is unreachable', async () => {
    const first = useHeadPositionsStore()
    await first.init()
    await first.refresh(fakeStocka([cap1]).stocka, 'parroquia')

    setActivePinia(createPinia())
    const again = useHeadPositionsStore()
    await again.init()
    expect(again.headsOf('parroquia')).toEqual({ Cap1: cap1 })
    expect(await again.refresh(fakeStocka(new Error('offline')).stocka, 'parroquia')).toBe(false)
    expect(again.headsOf('parroquia')).toEqual({ Cap1: cap1 })
  })

  it('an organization without the feature (403) has no heads', async () => {
    const store = useHeadPositionsStore()
    await store.init()
    await store.refresh(fakeStocka([cap1]).stocka, 'parroquia')
    expect(await store.refresh(fakeStocka(new StockaApiError(403, 'auth.forbidden', 'no')).stocka, 'parroquia')).toBe(false)
    expect(store.headsOf('parroquia')).toEqual({})
  })

  it('save patches the whole config with the position merged and updates the cache', async () => {
    const store = useHeadPositionsStore()
    await store.init()
    const { calls, stocka } = fakeStocka([cap1])
    await store.refresh(stocka, 'parroquia')
    expect(await store.save(stocka, 'parroquia', cap1, { name: 'portal', pan: 100, tilt: 20, zoom: 12 })).toBe(true)
    expect(calls).toContain('patch:parroquia:7')
    expect(headPositionsOf(store.headsOf('parroquia').Cap1!.config)).toEqual([{ name: 'portal', pan: 100, tilt: 20, zoom: 12 }])
    expect(await store.save(stocka, 'parroquia', store.headsOf('parroquia').Cap1!, { name: 'Estrella', pan: 300 })).toBe(false)
    expect(headPositionsOf(store.headsOf('parroquia').Cap1!.config).map((p) => p.name)).toEqual(['portal', 'Estrella'])
    await store.clear()
    expect(store.headsOf('parroquia')).toEqual({})
  })
})
