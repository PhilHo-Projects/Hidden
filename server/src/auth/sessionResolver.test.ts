import { describe, expect, it } from 'vitest'
import {
  createSessionResolver,
  type BetterAuthSessionApi,
} from './sessionResolver.js'

const USER_ID = '00000000-0000-4000-8000-000000000001'

function apiReturning(value: unknown): BetterAuthSessionApi {
  return {
    async getSession() {
      return value
    },
  }
}

describe('Better Auth public session resolver', () => {
  it('maps only the case-preserving public identity', async () => {
    const resolver = createSessionResolver(
      apiReturning({
        session: { id: 'private-session', token: 'private-token' },
        user: {
          id: USER_ID,
          username: 'player_one',
          displayUsername: 'Player_ONE',
          role: 'admin',
          email: 'private@example.test',
          emailVerified: true,
          image: 'https://private.example/avatar.png',
        },
      }),
      { cookieName: 'hidden_session' },
    )

    const identity = await resolver.resolve(
      new Headers({ cookie: 'hidden_session=secret' }),
    )

    expect(identity).toEqual({
      id: USER_ID,
      username: 'Player_ONE',
      role: 'admin',
    })
    expect(identity).not.toHaveProperty('email')
    expect(identity).not.toHaveProperty('emailVerified')
    expect(identity).not.toHaveProperty('session')
    expect(identity).not.toHaveProperty('token')
  })

  it.each([
    null,
    undefined,
    { user: { id: USER_ID, displayUsername: 'Player_ONE', role: 'owner' } },
    { user: { id: 'not-a-uuid', displayUsername: 'Player_ONE', role: 'admin' } },
    { user: { id: USER_ID, displayUsername: '', role: 'player' } },
  ])('fails safely for a missing or invalid stored identity', async (session) => {
    const resolver = createSessionResolver(apiReturning(session), {
      cookieName: 'hidden_session',
    })
    await expect(resolver.resolve(new Headers())).resolves.toBeUndefined()
  })

  it('passes incoming request headers to Better Auth without parsing a token', async () => {
    let received: Headers | undefined
    const resolver = createSessionResolver(
      {
        async getSession(input) {
          received = input.headers
          return null
        },
      },
      { cookieName: '__Host-hidden_session' },
    )

    await resolver.resolve({
      cookie: '__Host-hidden_session=opaque; theme=dark',
      'user-agent': 'Hidden test',
    })

    expect(received?.get('cookie')).toBe(
      '__Host-hidden_session=opaque; theme=dark',
    )
    expect(received?.get('user-agent')).toBe('Hidden test')
  })

  it('detects only the configured session cookie without reading its value', () => {
    const resolver = createSessionResolver(apiReturning(null), {
      cookieName: 'hidden_session',
    })

    expect(resolver.hasSessionCookie({ cookie: 'theme=dark' })).toBe(false)
    expect(
      resolver.hasSessionCookie({ cookie: 'theme=dark; hidden_session=opaque' }),
    ).toBe(true)
    expect(
      resolver.hasSessionCookie({ cookie: 'not_hidden_session=opaque' }),
    ).toBe(false)
  })
})
