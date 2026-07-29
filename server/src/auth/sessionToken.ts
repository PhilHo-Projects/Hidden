import { createHash, randomBytes } from 'node:crypto'

const PRODUCTION_COOKIE_NAME = '__Host-hidden_session'
const DEVELOPMENT_COOKIE_NAME = 'hidden_session'
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/

function cookieName(secure: boolean) {
  return secure ? PRODUCTION_COOKIE_NAME : DEVELOPMENT_COOKIE_NAME
}

export function hashSessionToken(rawToken: string) {
  return createHash('sha256').update(rawToken, 'utf8').digest()
}

export function createSessionToken() {
  const rawToken = randomBytes(32).toString('base64url')
  return {
    rawToken,
    tokenHash: hashSessionToken(rawToken),
  }
}

function serializeSessionCookie(
  value: string,
  secure: boolean,
  maxAgeSeconds: number,
) {
  const attributes = [
    `${cookieName(secure)}=${value}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    'Path=/',
    'HttpOnly',
  ]
  if (secure) {
    attributes.push('Secure')
  }
  attributes.push('SameSite=Lax')
  return attributes.join('; ')
}

export function createSessionCookie(
  rawToken: string,
  secure: boolean,
  maxAgeSeconds: number,
) {
  return serializeSessionCookie(rawToken, secure, maxAgeSeconds)
}

export function clearSessionCookie(secure: boolean) {
  return serializeSessionCookie('', secure, 0)
}

export function readSessionToken(
  cookieHeader: string | undefined,
  secure: boolean,
) {
  if (!cookieHeader) {
    return undefined
  }

  const name = cookieName(secure)
  const matches = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1))

  if (
    matches.length !== 1 ||
    !matches[0] ||
    !TOKEN_PATTERN.test(matches[0])
  ) {
    return undefined
  }
  return matches[0]
}
