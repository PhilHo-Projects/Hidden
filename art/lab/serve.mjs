import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

/*
 * A static server for the prototypes in this folder, and nothing else.
 *
 * It exists for one reason: the prototypes read the real game assets rather than
 * copies of them. Opening the files straight off disk cannot do that — a
 * `file://` page gets no origin worth the name, so the fonts are refused by CORS
 * and a relative path out of this folder is a reach across the filesystem. One
 * origin solves both, and it costs a dependency-free script.
 *
 * `/game/` maps to `web/src/assets/`, so a prototype showing the board
 * background is showing the background that ships. Change the asset and the
 * prototype changes with it; there is no second copy to forget.
 */

const LAB_ROOT = import.meta.dirname
const GAME_ASSETS = resolve(LAB_ROOT, '..', '..', 'web', 'src', 'assets')
const GAME_PREFIX = '/game/'
const PORT = Number(process.env.PORT ?? 4180)

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
}

/*
 * Resolve a request path inside exactly one of the two roots it is allowed to
 * reach. `normalize` collapses any `..` before the join rather than after, and
 * the result is checked against its root regardless, because a served folder is
 * still a folder on someone's machine.
 */
function resolveRequest(urlPath) {
  const decoded = decodeURIComponent(urlPath)
  const isGameAsset = decoded.startsWith(GAME_PREFIX)
  const root = isGameAsset ? GAME_ASSETS : LAB_ROOT
  const relative = normalize(isGameAsset ? decoded.slice(GAME_PREFIX.length) : decoded).replace(
    /^([/\\])+/,
    '',
  )
  const target = resolve(root, relative)

  if (target !== root && !target.startsWith(root + sep)) return null
  return target
}

async function resolveFile(target) {
  try {
    const stats = await stat(target)
    // A folder means the prototype in it: every prototype is a folder with an
    // `index.html`, so `/cell-palette` and `/cell-palette/` both land on it.
    return stats.isDirectory() ? join(target, 'index.html') : target
  } catch {
    return null
  }
}

createServer(async (request, response) => {
  const { pathname } = new URL(request.url, `http://localhost:${PORT}`)
  const target = resolveRequest(pathname)
  const file = target && (await resolveFile(target))

  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`not found: ${pathname}`)
    return
  }

  try {
    const body = await readFile(file)
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      // Prototypes are edited and reloaded constantly. A cached stylesheet here
      // is a wasted minute wondering why a change did nothing.
      'cache-control': 'no-store',
    })
    response.end(body)
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`not found: ${pathname}`)
  }
// Loopback only. This serves a subtree of a checkout, and nobody else on the
// network has a reason to read it.
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Hidden lab  →  http://localhost:${PORT}`)
  console.log(`game assets →  ${GAME_ASSETS}`)
})
