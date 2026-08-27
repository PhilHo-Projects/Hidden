import { describe, expect, it } from 'vitest'
import { resolveAllowedOrigins } from './serverConfig.js'

describe('resolveAllowedOrigins', () => {
  it('defaults local development to the Vite origins', () => {
    expect(resolveAllowedOrigins('development', undefined)).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ])
  })

  it('requires an explicit production origin and parses a comma-separated list', () => {
    expect(() => resolveAllowedOrigins('production', undefined)).toThrow(
      'ALLOWED_ORIGINS is required in production.',
    )
    expect(
      resolveAllowedOrigins(
        'production',
        'https://hidden.philippeho.dev, https://preview.example ',
      ),
    ).toEqual([
      'https://hidden.philippeho.dev',
      'https://preview.example',
    ])
  })
})
