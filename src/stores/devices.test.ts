import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { StockaApiError, type StockaClient } from '../api/stocka'
import { KEYS, setStorage } from '../storage'
import { createMemoryBundleFiles } from '../storage/bundleFiles'
import { createMemoryKv } from '../storage/kv'
import type { Organization, SavedDevice, StockaDevice } from '../types'
import { useDevicesStore } from './devices'

const ORGS: Organization[] = [
  { id: 1, name: 'Parròquia', slug: 'parroquia', currentUserRole: 'OWNER' },
  { id: 2, name: 'Associació', slug: 'associacio', currentUserRole: 'USER' },
  { id: 3, name: 'Sense maquinari', slug: 'sense', currentUserRole: 'OWNER' },
]

const device = (overrides: Partial<StockaDevice> = {}): StockaDevice => ({
  id: 1,
  deviceId: '6f1c2a9e-4b7d-4e21-9c3a-0d5e8f7b1a42',
  name: 'Pessebre parròquia',
  localUrl: 'http://belen.local:8080',
  pin: '482913',
  hasPin: true,
  online: false,
  lastShowName: null,
  ...overrides,
})

function fakeStocka(byOrg: Record<string, StockaDevice[] | Error>, orgsError?: Error) {
  const calls: string[] = []
  const stocka = {
    async listOrganizations() {
      calls.push('orgs')
      if (orgsError) throw orgsError
      return ORGS
    },
    async listDevices(slug: string) {
      calls.push(slug)
      const answer = byOrg[slug]
      if (answer instanceof Error) throw answer
      return answer ?? []
    },
  }
  return { stocka: stocka as unknown as StockaClient, calls }
}

describe('devices store', () => {
  let kv: ReturnType<typeof createMemoryKv>

  beforeEach(() => {
    kv = createMemoryKv()
    setStorage({ kv, files: createMemoryBundleFiles() })
    setActivePinia(createPinia())
  })

  it('loads the devices of every organization, skipping the ones without the hardware feature', async () => {
    const { stocka, calls } = fakeStocka({
      parroquia: [device(), device({ id: 2, name: 'Taller', localUrl: null })],
      associacio: [device({ id: 3, name: 'Pessebre gran', localUrl: 'http://10.42.0.1:8080', pin: null, hasPin: false })],
      sense: new StockaApiError(403, 'auth.forbidden', 'No tens permís.'),
    })
    const store = useDevicesStore()

    expect(await store.refresh(stocka)).toBe(true)

    expect(calls).toEqual(['orgs', 'parroquia', 'associacio', 'sense'])
    expect(store.devices.map((d) => [d.name, d.orgSlug])).toEqual([['Pessebre parròquia', 'parroquia'], ['Taller', 'parroquia'], ['Pessebre gran', 'associacio']])
    expect(store.connectable.map((d) => d.name)).toEqual(['Pessebre gran', 'Pessebre parròquia'])
    expect(store.sorted[0]!.orgName).toBe('Associació')
    expect(store.fetchedAt).not.toBeNull()
    expect(store.error).toBeNull()
  })

  it('keeps the saved list when Stocka cannot be reached', async () => {
    const good = fakeStocka({ parroquia: [device()] })
    const store = useDevicesStore()
    await store.refresh(good.stocka)
    const bad = fakeStocka({}, new Error('offline'))

    expect(await store.refresh(bad.stocka)).toBe(false)

    expect(store.devices).toHaveLength(1)
    expect(store.error).toBe('offline')
  })

  it('keeps the list when one organization fails for another reason than 403 and reports it', async () => {
    const store = useDevicesStore()
    await store.refresh(fakeStocka({ parroquia: [device()] }).stocka)

    const ok = await store.refresh(fakeStocka({ parroquia: new StockaApiError(500, 'server.error', 'boom') }).stocka)

    expect(ok).toBe(false)
    expect(store.devices).toHaveLength(1)
  })

  it('lets a session problem through for the auth store to handle', async () => {
    const store = useDevicesStore()
    const expired = new StockaApiError(401, 'auth.token_expired', 'La sessió ha caducat.')

    await expect(store.refresh(fakeStocka({}, expired).stocka)).rejects.toBe(expired)
  })

  it('remembers the list across restarts of the app and forgets it on clear', async () => {
    await useDevicesStore().refresh(fakeStocka({ parroquia: [device()] }).stocka)
    expect(kv.data.get(KEYS.devices)).toContain('Pessebre parròquia')

    setActivePinia(createPinia())
    const store = useDevicesStore()
    await store.init()
    expect(store.devices).toHaveLength(1)
    expect(store.devices[0]!.pin).toBe('482913')

    await store.clear()
    expect(store.devices).toEqual([])
    expect(kv.data.get(KEYS.devices)).not.toContain('Pessebre')
  })

  it('ignores a malformed saved list', async () => {
    await kv.set(KEYS.devices, JSON.stringify({ devices: [{ nope: true }, 'x'], fetchedAt: 3 }))
    const store = useDevicesStore()
    await store.init()
    expect(store.devices).toEqual([])
    expect(store.fetchedAt).toBeNull()
  })

  it('finds the saved device of a connection by uuid first, then by address', async () => {
    const store = useDevicesStore()
    await store.refresh(fakeStocka({ parroquia: [device(), device({ id: 2, name: 'Altra', deviceId: 'other-uuid', localUrl: 'http://10.42.0.1:8080/' })] }).stocka)

    expect(store.find('http://belen.local:8080', null)?.name).toBe('Pessebre parròquia')
    expect(store.find('http://10.42.0.1:8080', null)?.name).toBe('Altra')
    expect(store.find('http://belen.local:8080', 'other-uuid')?.name).toBe('Altra')
    expect(store.find('http://192.168.1.9:8080', 'unknown')).toBeUndefined()
    expect(store.find(null, null)).toBeUndefined()
  })

  it('does not run two refreshes at once', async () => {
    const store = useDevicesStore()
    const { stocka, calls } = fakeStocka({ parroquia: [device()] })
    const [a, b] = await Promise.all([store.refresh(stocka), store.refresh(stocka)])
    expect([a, b]).toEqual([true, false])
    expect(calls.filter((c) => c === 'orgs')).toHaveLength(1)
  })
})

describe('SavedDevice shape', () => {
  it('is a Stocka device plus its organization', () => {
    const saved: SavedDevice = { ...device(), orgSlug: 'parroquia', orgName: 'Parròquia' }
    expect(saved.orgSlug).toBe('parroquia')
  })
})
