import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'

import type { StockaClient } from '../api/stocka'
import { getBundleFiles, getKv, KEYS } from '../storage'
import { readJson, writeJson } from '../storage/kv'
import type { LibraryEntry, Organization, Timeline } from '../types'
import { bundleFileName } from '../util/bundleName'

export type DownloadPhase = 'preparing' | 'downloading' | 'done' | 'error'

export interface DownloadProgress {
  phase: DownloadPhase
  received: number
  total: number | null
  error: unknown
}

/** `orgSlug/timelineId`: a timeline has at most one bundle in the library. */
export function downloadKey(orgSlug: string, timelineId: number): string {
  return `${orgSlug}/${timelineId}`
}

function isEntry(value: unknown): value is LibraryEntry {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.fileName === 'string' && typeof v.hash === 'string' && typeof v.timelineId === 'number' && typeof v.orgSlug === 'string'
}

/**
 * Downloaded bundles: the files live in the bundle file store, the index in Preferences. Works
 * entirely offline; only {@link download} talks to Stocka.
 */
export const useLibraryStore = defineStore('library', () => {
  const entries = ref<LibraryEntry[]>([])
  const ready = ref(false)
  const downloads = reactive<Record<string, DownloadProgress>>({})

  const count = computed(() => entries.value.length)
  const sorted = computed(() => [...entries.value].sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt)))

  async function init(): Promise<void> {
    const saved = await readJson<unknown>(getKv(), KEYS.libraryIndex)
    entries.value = Array.isArray(saved) ? saved.filter(isEntry) : []
    ready.value = true
  }

  async function persist(): Promise<void> {
    await writeJson(getKv(), KEYS.libraryIndex, entries.value)
  }

  function findByTimeline(orgSlug: string, timelineId: number): LibraryEntry | undefined {
    return entries.value.find((e) => e.orgSlug === orgSlug && e.timelineId === timelineId)
  }

  function findByFileName(fileName: string): LibraryEntry | undefined {
    return entries.value.find((e) => e.fileName === fileName)
  }

  function findByHash(hash: string): LibraryEntry | undefined {
    return entries.value.find((e) => e.hash === hash)
  }

  /** Adds or replaces (same file name, or same timeline) an entry and persists the index. */
  async function add(entry: LibraryEntry): Promise<void> {
    entries.value = [
      ...entries.value.filter((e) => e.fileName !== entry.fileName && !(e.orgSlug === entry.orgSlug && e.timelineId === entry.timelineId)),
      entry,
    ]
    await persist()
  }

  /** Removes the entry and its file. */
  async function remove(fileName: string): Promise<void> {
    entries.value = entries.value.filter((e) => e.fileName !== fileName)
    await persist()
    await getBundleFiles().delete(fileName)
  }

  /**
   * Downloads the bundle of a timeline into the library: `GET …/show` for the name and hash (and
   * the 422 findings if the scene is not exportable), then `GET …/bundle` streamed to disk. An
   * identical bundle already in the library is not downloaded again.
   */
  async function download(client: StockaClient, org: Organization, timeline: Timeline): Promise<LibraryEntry> {
    const key = downloadKey(org.slug, timeline.id)
    downloads[key] = { phase: 'preparing', received: 0, total: null, error: null }
    const files = getBundleFiles()
    try {
      const meta = await client.getShowMeta(org.slug, timeline.id)
      const name = meta.name || timeline.name
      const fileName = bundleFileName(name, meta.hash)
      const existing = findByTimeline(org.slug, timeline.id)
      if (existing && existing.hash === meta.hash && (await files.exists(existing.fileName))) {
        downloads[key] = { phase: 'done', received: existing.size, total: existing.size, error: null }
        return existing
      }

      const writer = await files.createWriter(fileName)
      downloads[key] = { phase: 'downloading', received: 0, total: null, error: null }
      let bytes: number
      try {
        const result = await client.downloadBundle(org.slug, timeline.id, writer, {
          onProgress: (received, total) => {
            downloads[key] = { phase: 'downloading', received, total, error: null }
          },
        })
        await writer.close()
        bytes = result.bytes
      } catch (err) {
        await writer.abort()
        throw err
      }

      if (existing && existing.fileName !== fileName) await files.delete(existing.fileName)
      const entry: LibraryEntry = {
        fileName,
        hash: meta.hash,
        name,
        orgSlug: org.slug,
        orgName: org.name,
        timelineId: timeline.id,
        size: bytes,
        downloadedAt: new Date().toISOString(),
      }
      await add(entry)
      downloads[key] = { phase: 'done', received: bytes, total: bytes, error: null }
      return entry
    } catch (err) {
      downloads[key] = { phase: 'error', received: 0, total: null, error: err }
      throw err
    }
  }

  function clearDownload(key: string): void {
    delete downloads[key]
  }

  return { entries, sorted, count, ready, downloads, init, add, remove, findByTimeline, findByFileName, findByHash, download, clearDownload }
})
