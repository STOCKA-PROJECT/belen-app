import { Preferences } from '@capacitor/preferences'

import type { KeyValueStore } from './kv'

/** Capacitor Preferences (SharedPreferences on Android, UserDefaults on iOS, localStorage on web). */
export function createPreferencesKv(): KeyValueStore {
  return {
    async get(key) {
      const { value } = await Preferences.get({ key })
      return value
    },
    async set(key, value) {
      await Preferences.set({ key, value })
    },
    async remove(key) {
      await Preferences.remove({ key })
    },
  }
}
