import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const CORE_DIST = fileURLToPath(
  new URL('../packages/game-core/dist/index.js', import.meta.url),
)
const DEPS_CACHE = fileURLToPath(new URL('./node_modules/.vite/deps', import.meta.url))

/*
 * Rebuilding @hidden/game-core does not invalidate Vite's dep optimizer. It is
 * a symlinked workspace package pinned at 0.0.0, so nothing the optimizer keys
 * on -- lockfile, version, config -- changes when only the built bytes do, and
 * it keeps serving the previously optimized bundle from `node_modules/.vite`.
 *
 * Dropping the cache and restarting is heavy, but it is what the situation
 * actually calls for, and it only fires when that one file is rewritten.
 */
function reoptimiseLinkedCore(): Plugin {
  return {
    name: 'hidden:reoptimise-linked-core',
    apply: 'serve',
    configureServer(server) {
      server.watcher.add(CORE_DIST)
      server.watcher.on('change', (file) => {
        if (resolve(file) !== CORE_DIST) return
        server.config.logger.info('[hidden] game-core rebuilt, re-optimising deps')
        void rm(DEPS_CACHE, { recursive: true, force: true }).then(() => server.restart())
      })
    },
  }
}

/*
 * Vite serves its pre-bundled dependencies with `max-age=31536000, immutable`
 * at a URL keyed on `browserHash`. That is safe for real npm packages, whose
 * contents cannot change without a lockfile change. `@hidden/game-core` is a
 * symlinked workspace package pinned at 0.0.0, so rebuilding it changes the
 * bytes while the lockfile, the version, and often the hash stay identical --
 * and the browser goes on serving the previous build from disk cache forever.
 *
 * The failure is silent and badly misleading: index.html and every source file
 * are fresh, so the app runs, and only the engine is stale. It shows up as a
 * rule that does nothing, or as `X is not a function` for an export added since
 * the cached copy was written.
 *
 * Revalidating these responses costs a 304 on localhost and removes the whole
 * class of problem. Dev only; the production build never goes through this path.
 */
function revalidateOptimizedDeps(): Plugin {
  return {
    name: 'hidden:revalidate-optimized-deps',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.includes('/node_modules/.vite/deps/')) {
          // Patched rather than set: Vite writes its own Cache-Control after
          // this middleware runs, so setting the header here would be overwritten.
          const setHeader = res.setHeader.bind(res)
          res.setHeader = (name: string, value: never) =>
            setHeader(name, /^cache-control$/i.test(name) ? 'no-cache' : value)
        }
        next()
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Both halves are needed: one makes Vite rebuild the bundle, the other stops
  // the browser serving its immutable copy of the previous one.
  plugins: [react(), tailwindcss(), reoptimiseLinkedCore(), revalidateOptimizedDeps()],
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
