export interface AuthEnvironment {
  NODE_ENV?: string
  DATABASE_URL?: string
  BETTER_AUTH_URL?: string
  BETTER_AUTH_SECRET?: string
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
  TURNSTILE_SECRET_KEY?: string
  ALLOWED_ORIGINS?: string
  TRUST_PROXY_HOPS?: string
}

export interface DisabledAuthConfig {
  enabled: false
}

export interface EnabledAuthConfig {
  enabled: true
  production: boolean
  databaseUrl: string
  baseURL: string
  secret: string
  resendApiKey: string
  emailFrom: string
  turnstileSecretKey: string
  allowedOrigins: string[]
  trustProxyHops: number | false
}

export type AuthConfig = DisabledAuthConfig | EnabledAuthConfig
export type AuthEnvironmentKey = keyof AuthEnvironment

export class AuthConfigurationError extends Error {
  constructor(readonly key: AuthEnvironmentKey) {
    super(`Invalid or missing auth configuration: ${key}.`)
    this.name = 'AuthConfigurationError'
  }
}

function required(
  environment: AuthEnvironment,
  key: AuthEnvironmentKey,
) {
  const value = environment[key]?.trim()
  if (!value) {
    throw new AuthConfigurationError(key)
  }
  return value
}

function parseDatabaseUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
      throw new Error('Unsupported database protocol.')
    }
    return value
  } catch {
    throw new AuthConfigurationError('DATABASE_URL')
  }
}

function parseOrigin(
  value: string,
  key: 'BETTER_AUTH_URL' | 'ALLOWED_ORIGINS',
  production: boolean,
) {
  try {
    const url = new URL(value)
    const permittedProtocol =
      url.protocol === 'https:' || (!production && url.protocol === 'http:')
    if (
      !permittedProtocol ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('Expected an absolute origin.')
    }
    return url.origin
  } catch {
    throw new AuthConfigurationError(key)
  }
}

function parseAllowedOrigins(value: string, production: boolean) {
  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => parseOrigin(origin, 'ALLOWED_ORIGINS', production))
  if (origins.length === 0) {
    throw new AuthConfigurationError('ALLOWED_ORIGINS')
  }
  return [...new Set(origins)]
}

function parseEmailFrom(value: string) {
  const address = /<([^<>]+)>$/.exec(value)?.[1] ?? value
  if (
    /[\r\n]/.test(value) ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)
  ) {
    throw new AuthConfigurationError('AUTH_EMAIL_FROM')
  }
  return value
}

function parseTrustProxyHops(
  value: string | undefined,
  production: boolean,
) {
  if (!value?.trim()) {
    if (production) {
      throw new AuthConfigurationError('TRUST_PROXY_HOPS')
    }
    return false
  }
  const hops = Number(value)
  if (!Number.isSafeInteger(hops) || hops < 1) {
    throw new AuthConfigurationError('TRUST_PROXY_HOPS')
  }
  return hops
}

export function resolveAuthConfig(
  environment: AuthEnvironment,
): AuthConfig {
  const production = environment.NODE_ENV === 'production'
  const databaseUrl = environment.DATABASE_URL?.trim()
  if (!databaseUrl && !production) {
    return { enabled: false }
  }

  const secret = required(environment, 'BETTER_AUTH_SECRET')
  if (
    Array.from(secret).length < 32 ||
    Buffer.byteLength(secret, 'utf8') < 32
  ) {
    throw new AuthConfigurationError('BETTER_AUTH_SECRET')
  }

  return {
    enabled: true,
    production,
    databaseUrl: parseDatabaseUrl(required(environment, 'DATABASE_URL')),
    baseURL: parseOrigin(
      required(environment, 'BETTER_AUTH_URL'),
      'BETTER_AUTH_URL',
      production,
    ),
    secret,
    resendApiKey: required(environment, 'RESEND_API_KEY'),
    emailFrom: parseEmailFrom(required(environment, 'AUTH_EMAIL_FROM')),
    turnstileSecretKey: required(environment, 'TURNSTILE_SECRET_KEY'),
    allowedOrigins: parseAllowedOrigins(
      required(environment, 'ALLOWED_ORIGINS'),
      production,
    ),
    trustProxyHops: parseTrustProxyHops(
      environment.TRUST_PROXY_HOPS,
      production,
    ),
  }
}
