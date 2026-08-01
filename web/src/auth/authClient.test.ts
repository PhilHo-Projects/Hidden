import { describe, expect, it, vi } from 'vitest'
import {
  AuthApiError,
  createAuthClient,
  type AuthUser,
} from './authClient'

const USER: AuthUser = {
  id: '9133d041-fdae-48fc-969d-c9e868c94b79',
  username: 'Player_One',
  role: 'player',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('authClient', () => {
  it('restores the current same-origin session', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ user: USER }),
    )
    const client = createAuthClient(fetcher)

    await expect(client.getSession()).resolves.toEqual(USER)
    expect(fetcher).toHaveBeenCalledWith('/api/auth/session', {
      headers: { Accept: 'application/json' },
    })
  })

  it('sends only username and password when registering', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ user: USER }, 201),
    )
    const client = createAuthClient(fetcher)

    await expect(
      client.register('Player_One', 'correct horse battery staple'),
    ).resolves.toEqual(USER)
    expect(fetcher).toHaveBeenCalledWith('/api/auth/register', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: 'Player_One',
        password: 'correct horse battery staple',
      }),
    })
  })

  it('preserves stable API errors for inline form feedback', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: 'username_taken',
            message: 'That username is already taken.',
            field: 'username',
          },
        },
        409,
      ),
    )
    const client = createAuthClient(fetcher)

    await expect(
      client.register('Player_One', 'correct horse battery staple'),
    ).rejects.toEqual(
      expect.objectContaining<Partial<AuthApiError>>({
        code: 'username_taken',
        field: 'username',
        message: 'That username is already taken.',
      }),
    )
  })

  it('logs out without expecting a JSON response body', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    )
    const client = createAuthClient(fetcher)

    await expect(client.logout()).resolves.toBeUndefined()
    expect(fetcher).toHaveBeenCalledWith('/api/auth/logout', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  })
})
