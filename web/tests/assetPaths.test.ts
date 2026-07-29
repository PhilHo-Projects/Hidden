import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(fileURLToPath(new URL('../src/index.css', import.meta.url)), 'utf8')

describe('source asset URLs', () => {
  it('uses root /src URLs for CSS-served assets during Vite development', () => {
    expect(stylesheet).not.toContain('url("./assets/')
    expect(stylesheet).toContain('url("/src/assets/fonts/edosz.ttf")')
    expect(stylesheet).toContain('url("/src/assets/textures/button-splash.png")')
  })
})
