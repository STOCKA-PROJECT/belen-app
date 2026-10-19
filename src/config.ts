import { Capacitor } from '@capacitor/core'

/** True inside the Android/iOS shell; false in a desktop browser (`pnpm dev`). */
export const IS_NATIVE = Capacitor.isNativePlatform()

/** In a browser during development the Vite proxy stands in for both servers (see vite.config.ts). */
const USE_DEV_PROXY = import.meta.env.DEV && !IS_NATIVE

export const DEFAULT_STOCKA_URL = USE_DEV_PROXY ? '/__stocka' : 'https://stocka.xeye.es'

/** Addresses printed on the label of the box, tried in this order. */
export const PI_URL_CANDIDATES = ['http://belen.local:8080', 'http://10.42.0.1:8080'] as const

export const DEFAULT_PI_URL: string = USE_DEV_PROXY ? '/__pi' : PI_URL_CANDIDATES[0]

/** Status polling period when SSE is unavailable. */
export const PI_POLL_MS = 2000
