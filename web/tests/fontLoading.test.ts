import { execSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'

const webRoot = fileURLToPath(new URL('..', import.meta.url))
const distRoot = fileURLToPath(new URL('../dist', import.meta.url))
const distAssets = fileURLToPath(new URL('../dist/assets', import.meta.url))

/*
 * This hook shells out to a full `tsc -b && vite build`, which takes several
 * seconds on its own and competes with every other suite vitest runs in
 * parallel. Vitest's 10s default left no headroom: adding one more test file
 * anywhere in the project was enough to time the hook out and silently skip the
 * assertions below. The ceiling is generous on purpose — it exists to catch a
 * hung build, not to police how long a healthy one takes.
 */
const BUILD_TIMEOUT_MS = 180_000

beforeAll(() => {
  execSync('npm run build', {
    cwd: webRoot,
    stdio: 'pipe',
  })
}, BUILD_TIMEOUT_MS)

function findBuiltAsset(prefix: string, extension: string) {
  const matches = readdirSync(distAssets).filter(
    (fileName) => fileName.startsWith(`${prefix}-`) && fileName.endsWith(extension),
  )

  expect(matches).toHaveLength(1)
  return matches[0]!
}

function getFontFace(stylesheet: string, family: string) {
  const familyValue = `(?:"${escapeRegExp(family)}"|${escapeRegExp(family)})`
  return stylesheet.match(
    new RegExp(`@font-face\\s*{[^}]*font-family:\\s*${familyValue}[^}]*}`, 's'),
  )?.[0]
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

describe('critical font loading', () => {
  it('builds and preloads compressed critical fonts without a fallback-font swap', () => {
    const html = readFileSync(`${distRoot}/index.html`, 'utf8')
    const stylesheetName = findBuiltAsset('index', '.css')
    const stylesheet = readFileSync(`${distAssets}/${stylesheetName}`, 'utf8')
    const criticalFonts = [
      { family: 'Edo SZ', prefix: 'edosz', originalBytes: 48_820 },
      {
        family: 'JetBrains Mono',
        prefix: 'jetbrains-mono-bold',
        originalBytes: 277_828,
      },
    ]

    for (const font of criticalFonts) {
      const fileName = findBuiltAsset(font.prefix, '.woff2')
      const publicPath = `/assets/${fileName}`
      const face = getFontFace(stylesheet, font.family)

      expect(html).toMatch(
        new RegExp(
          `<link\\s+rel="preload"\\s+href="${escapeRegExp(publicPath)}"\\s+as="font"\\s+type="font/woff2"\\s+crossorigin\\s*/?>`,
          's',
        ),
      )
      expect(stylesheet).toContain(publicPath)
      expect(face).toContain('font-display:block')
      expect(statSync(`${distAssets}/${fileName}`).size).toBeLessThan(font.originalBytes)
    }
  })
})
