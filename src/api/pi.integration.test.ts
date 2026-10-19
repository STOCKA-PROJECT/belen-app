import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { BundleSource } from '../storage/bundleFiles'
import { PiClient } from './pi'

/**
 * Runs against a real `belen-api` (for example `python main.py --simulate --no-screen --port 8081
 * --storage /tmp/belen` in rpi4-system). Skipped unless the environment provides:
 *   BELEN_PI_URL=http://127.0.0.1:8081 BELEN_PI_PIN=123456 BELEN_BUNDLE=/path/to/x.belen.zip
 */
const url = process.env.BELEN_PI_URL
const pin = process.env.BELEN_PI_PIN
const bundlePath = process.env.BELEN_BUNDLE
const enabled = !!(url && pin && bundlePath)

describe.skipIf(!enabled)('PiClient against a real belen-api', () => {
  const bytes = enabled ? new Uint8Array(readFileSync(bundlePath!)) : new Uint8Array(0)
  const source: BundleSource = {
    name: bundlePath?.split('/').pop() ?? 'x.belen.zip',
    size: bytes.byteLength,
    async slice(start, end) {
      return bytes.subarray(start, end)
    },
  }

  it('reads info and status without a PIN', async () => {
    const client = new PiClient({ baseUrl: url!, eventSourceFactory: null })
    const info = await client.info()
    expect(info.apiVersion).toBe(1)
    const status = await client.status()
    expect(status.state).toBeTypeOf('string')
  })

  it('uploads the bundle in chunks, activates it, cuts a port, plays and stops', async () => {
    const client = new PiClient({ baseUrl: url!, pin, name: 'vitest', chunkSize: 256 * 1024, singleShotMax: 0, eventSourceFactory: null })
    const progress: number[] = []
    const ids: Array<string | null> = []

    const result = await client.uploadBundle(source, { activate: true, onProgress: (s) => progress.push(s), onUploadId: (id) => ids.push(id) })

    expect(result.status).toBe(200)
    expect(result.report.ok).toBe(true)
    expect(result.report.activated).toBe(true)
    expect(progress.at(-1)).toBe(bytes.byteLength)
    expect(ids.at(-1)).toBeNull()

    const bundles = await client.bundles()
    expect(bundles.shows.some((s) => s.hash === result.report.hash && s.active)).toBe(true)

    const status = await client.status()
    expect(status.showHash).toBe(result.report.hash)
    expect(status.hardware.length).toBeGreaterThan(0)

    const port = status.hardware[0]!
    const cut = await client.setOverride(port.name, 'off')
    expect(cut.off).toContain(port.name)
    expect(cut.hardware.find((h) => h.name === port.name)?.off).toBe(true)
    const restored = await client.setOverride(port.name, 'normal')
    expect(restored.off).not.toContain(port.name)

    const playing = await client.play()
    expect(playing.state).toBe('PLAYING')
    const stopped = await client.stop()
    expect(stopped.state).not.toBe('PLAYING')

    // same bundle again: the Pi skips the assets it already has
    const again = await client.uploadBundle(source, { activate: false })
    expect(again.status).toBe(200)
    expect(again.report.skipped.length).toBeGreaterThan(0)
  })

  it('rejects a wrong PIN with pin_invalid', async () => {
    const client = new PiClient({ baseUrl: url!, pin: '000000', eventSourceFactory: null })
    await expect(client.stop()).rejects.toMatchObject({ code: 'pin_invalid', status: 401 })
  })
})
