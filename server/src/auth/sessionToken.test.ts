import { describe, expect, it } from 'vitest'
import {
  clearSessionCookie,
  createSessionCookie,
  createSessionToken,
  hashSessionToken,
  readSessionToken,
} from './sessionToken'

describe('session tokens', () => {
  it('returns a random opaque token and stores only its SHA-256 digest', () => {
    const first = createSessionToken()
    const second = createSessionToken()

    expect(first.rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.tokenHash).toHaveLength(32)
    expect(first.tokenHash).toEqual(hashSessionToken(first.rawToken))
    expect(first.rawToken).not.toBe(second.rawToken)
  })

  it('serializes and reads a production host cookie with the required protections', () => {
    const cookie = createSessionCookie('opaque-token', true, 2_592_000)

    expect(cookie).toBe(
      '__Host-hidden_session=opaque-token; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax',
    )
    expect(
      readSessionToken('theme=dark; __Host-hidden_session=opaque-token', true),
    ).toBe('opaque-token')
  })

  it('uses a non-Secure development cookie and clears the matching cookie name', () => {
    expect(createSessionCookie('local-token', false, 60)).toBe(
      'hidden_session=local-token; Max-Age=60; Path=/; HttpOnly; SameSite=Lax',
    )
    expect(readSessionToken('hidden_session=local-token', false)).toBe(
      'local-token',
    )
    expect(clearSessionCookie(false)).toBe(
      'hidden_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax',
    )
  })

  it('rejects malformed or ambiguously duplicated session cookies', () => {
    expect(readSessionToken('hidden_session=bad token', false)).toBeUndefined()
    expect(
      readSessionToken(
        'hidden_session=first; hidden_session=second',
        false,
      ),
    ).toBeUndefined()
  })
})
