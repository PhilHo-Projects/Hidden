import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))
const stylesheets = readdirSync(sourceRoot, { recursive: true })
  .filter((fileName) => fileName.endsWith('.css'))
  .map((fileName) => readFileSync(join(sourceRoot, fileName), 'utf8'))
  .join('\n')

describe('source asset URLs', () => {
  it('uses root /src URLs for CSS-served assets during Vite development', () => {
    expect(stylesheets).not.toContain('url("./assets/')
    expect(stylesheets).toContain('url("/src/assets/fonts/edosz.woff2")')
    expect(stylesheets).toContain('url("/src/assets/textures/button-splash.png")')
  })
})
