import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native shell configuration.
 *
 * - `server.cleartext: true` makes `cap sync` add `android:usesCleartextTraffic="true"` to the
 *   Android manifest (needed to talk to `http://belen.local:8080` / `http://10.42.0.1:8080`).
 *   The app never uses HTTP in the clear for anything but the Raspberry Pi on the local Wi-Fi.
 * - `android.allowMixedContent: true` lets the WebView itself (origin `https://localhost`) open
 *   `http://` resources such as the Pi's SSE stream.
 * - `plugins.CapacitorHttp.enabled: true` routes `fetch` through the native HTTP stack on
 *   Android/iOS: GET requests go through the local WebView proxy (streaming, binary-safe) and
 *   writes through the plugin. This is what lets the app call the Pi API (which sends no CORS
 *   headers) and the Stocka backend (explicit CORS allowlist) without CORS.
 */
const config: CapacitorConfig = {
  appId: 'es.xeye.stocka.belen',
  appName: 'Pessebre',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
