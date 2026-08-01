import { describe, expect, it } from 'vitest'
import {
  resolveAllowedOrigins,
  resolveAdminUsernames,
  resolveDatabaseUrl,
} from './serverConfig'

describe('resolveDatabaseUrl', () => {
  it('allows explicit guest-only local development', () => {
    expect(resolveDatabaseUrl('development', undefined)).toBeUndefined()
    expect(resolveDatabaseUrl('test', '')).toBeUndefined()
  })

  it('requires PostgreSQL configuration in production', () => {
    expect(() => resolveDatabaseUrl('production', undefined)).toThrow(
      'DATABASE_URL is required in production.',
    )
    expect(
      resolveDatabaseUrl(
        'production',
        'postgresql://hidden:secret@postgres/hidden',
      ),
    ).toBe('postgresql://hidden:secret@postgres/hidden')
  })
})

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

describe('resolveAdminUsernames', () => {
  it('defaults absent or empty configuration to no administrators', () => {
    expect(resolveAdminUsernames(undefined)).toEqual(new Set())
    expect(resolveAdminUsernames('  , ')).toEqual(new Set())
  })

  it('normalizes configured usernames like credential login', () => {
    expect(resolveAdminUsernames(' Ecco,PLAYER_two, ecco ')).toEqual(
      new Set(['ecco', 'player_two']),
    )
  })
})
