import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // @hidden/game-core emits CommonJS. Vite leaves linked workspace packages
  // unbundled by default, and the dev server cannot import CJS as ESM, so the
  // app fails to mount under `npm run dev`. Forcing it through the optimizer
  // converts it to ESM. The production build is unaffected: Rollup already
  // handles CJS.
  optimizeDeps: {
    include: ['@hidden/game-core'],
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
      },
      '/ws': {
        target: 'ws://127.0.0.1:8080',
        ws: true,
      },
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
