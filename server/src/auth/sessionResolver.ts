import type { IncomingHttpHeaders } from 'node:http'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PUBLIC_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,24}$/

export type UserRole = 'player' | 'admin'

export interface PublicSessionIdentity {
  readonly id: string
  readonly username: string
  readonly role: UserRole
}

export interface BetterAuthSessionApi {
  getSession(input: { headers: Headers }): Promise<unknown>
}

export type SessionRequestHeaders = Headers | IncomingHttpHeaders

export interface PublicSessionResolver {
  resolve(
    headers: SessionRequestHeaders,
  ): Promise<PublicSessionIdentity | undefined>
  hasSessionCookie(headers: SessionRequestHeaders): boolean
}

function webHeaders(input: SessionRequestHeaders) {
  if (input instanceof Headers) return new Headers(input)
  const result = new Headers()
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) result.append(name, item)
    } else {
      result.set(name, value)
    }
  }
  return result
}

function publicIdentity(value: unknown): PublicSessionIdentity | undefined {
  if (!value || typeof value !== 'object') return undefined
  const user = (value as { user?: unknown }).user
  if (!user || typeof user !== 'object') return undefined
  const record = user as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    !UUID_PATTERN.test(record.id) ||
    typeof record.displayUsername !== 'string' ||
    !PUBLIC_USERNAME_PATTERN.test(record.displayUsername) ||
    (record.role !== 'player' && record.role !== 'admin')
  ) {
    return undefined
  }
  return {
    id: record.id,
    username: record.displayUsername,
    role: record.role,
  }
}

function cookieHeader(input: SessionRequestHeaders) {
  if (input instanceof Headers) return input.get('cookie') ?? undefined
  const value = input.cookie
  return Array.isArray(value) ? value.join('; ') : value
}

function escapePattern(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function createSessionResolver(
  api: BetterAuthSessionApi,
  options: { cookieName: string },
): PublicSessionResolver {
  const cookiePattern = new RegExp(
    `(?:^|;\\s*)${escapePattern(options.cookieName)}=`,
  )
  return {
    async resolve(headers) {
      return publicIdentity(
        await api.getSession({ headers: webHeaders(headers) }),
      )
    },
    hasSessionCookie(headers) {
      return cookiePattern.test(cookieHeader(headers) ?? '')
    },
  }
}
