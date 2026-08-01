export interface AuthUser {
  id: string
  role: 'player' | 'admin'
  username: string
}

export type AuthErrorCode =
  | 'invalid_input'
  | 'username_taken'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'account_service_unavailable'

export class AuthApiError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    readonly field?: 'username' | 'password',
  ) {
    super(message)
    this.name = 'AuthApiError'
  }
}

interface AuthUserResponse {
  user: AuthUser
}

interface SessionResponse {
  user: AuthUser | null
}

type Fetcher = typeof fetch

export function createAuthClient(fetcher: Fetcher = fetch) {
  async function request<T>(url: string, init: RequestInit) {
    let response: Response
    try {
      response = await fetcher(url, init)
    } catch {
      throw new AuthApiError(
        'account_service_unavailable',
        'Accounts are temporarily unavailable.',
      )
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as
        | {
            error?: {
              code?: AuthErrorCode
              message?: string
              field?: 'username' | 'password'
            }
          }
        | undefined
      throw new AuthApiError(
        body?.error?.code ?? 'account_service_unavailable',
        body?.error?.message ?? 'Accounts are temporarily unavailable.',
        body?.error?.field,
      )
    }
    if (response.status === 204) {
      return undefined as T
    }
    return (await response.json()) as T
  }

  function credentialsRequest(
    endpoint: 'register' | 'login',
    username: string,
    password: string,
  ) {
    return request<AuthUserResponse>(`/api/auth/${endpoint}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    }).then(({ user }) => user)
  }

  return {
    getSession() {
      return request<SessionResponse>('/api/auth/session', {
        headers: { Accept: 'application/json' },
      }).then(({ user }) => user)
    },
    register(username: string, password: string) {
      return credentialsRequest('register', username, password)
    },
    login(username: string, password: string) {
      return credentialsRequest('login', username, password)
    },
    logout() {
      return request<void>('/api/auth/logout', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
    },
  }
}

export type AuthClient = ReturnType<typeof createAuthClient>
