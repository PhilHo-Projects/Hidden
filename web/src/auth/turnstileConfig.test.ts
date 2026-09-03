import { describe, expect, it } from 'vitest'
import { resolveTurnstileSiteKey } from './turnstileConfig'

describe('Turnstile client configuration', () => {
  it('fails a production build without an explicit public site key', () => {
    expect(() => resolveTurnstileSiteKey(undefined, true)).toThrow(
      'VITE_TURNSTILE_SITE_KEY',
    )
    expect(() => resolveTurnstileSiteKey('   ', true)).toThrow(
      'VITE_TURNSTILE_SITE_KEY',
    )
  })

  it('returns the configured key and permits an unconfigured local guest build', () => {
    expect(resolveTurnstileSiteKey(' site-key ', true)).toBe('site-key')
    expect(resolveTurnstileSiteKey(undefined, false)).toBe('')
  })
})
