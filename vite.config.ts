import vue from '@vitejs/plugin-vue'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * `pnpm dev` runs in a desktop browser, where neither the Raspberry Pi (no CORS headers) nor the
 * Stocka backend (explicit CORS allowlist) can be called directly. The dev server proxies both:
 * the app uses `/__pi` and `/__stocka` as base URLs when it detects it is running on the web in
 * dev mode (see `src/config.ts`). Override the targets with `VITE_PI_PROXY_TARGET` and
 * `VITE_STOCKA_PROXY_TARGET` in `.env.local`.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const piTarget = env.VITE_PI_PROXY_TARGET || 'http://belen.local:8080'
  const stockaTarget = env.VITE_STOCKA_PROXY_TARGET || 'https://stocka.xeye.es'
  return {
    plugins: [vue()],
    server: {
      port: 5180,
      proxy: {
        '/__pi': { target: piTarget, changeOrigin: true, rewrite: (p) => p.replace(/^\/__pi/, '') },
        '/__stocka': { target: stockaTarget, changeOrigin: true, rewrite: (p) => p.replace(/^\/__stocka/, '') },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: false,
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  }
})
