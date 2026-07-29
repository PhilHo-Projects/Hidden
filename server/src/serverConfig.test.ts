import { describe, expect, it } from 'vitest'
import { resolveDatabaseUrl } from './serverConfig'

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
