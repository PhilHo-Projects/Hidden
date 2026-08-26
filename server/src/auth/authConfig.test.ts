import { describe, expect, it } from 'vitest'
import {
  AuthConfigurationError,
  resolveAuthConfig,
  type AuthEnvironment,
} from './authConfig.js'

const PRODUCTION_ENVIRONMENT = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://hidden:secret@postgres/hidden',
  BETTER_AUTH_URL: 'https://hidden.philippeho.dev',
  BETTER_AUTH_SECRET: '0123456789abcdef0123456789abcdef',
  RESEND_API_KEY: 're_test_only',
  AUTH_EMAIL_FROM: 'Hidden <no-reply@philippeho.dev>',
  TURNSTILE_SECRET_KEY: 'turnstile-test-only',
  ALLOWED_ORIGINS: 'https://hidden.philippeho.dev',
  TRUST_PROXY_HOPS: '1',
} satisfies AuthEnvironment

describe('resolveAuthConfig', () => {
  it('keeps development guest-only when PostgreSQL is not configured', () => {
    expect(resolveAuthConfig({ NODE_ENV: 'development' })).toEqual({
      enabled: false,
    })
  })

  it.each([
    'DATABASE_URL',
    'BETTER_AUTH_URL',
    'BETTER_AUTH_SECRET',
    'RESEND_API_KEY',
    'AUTH_EMAIL_FROM',
    'TURNSTILE_SECRET_KEY',
    'ALLOWED_ORIGINS',
    'TRUST_PROXY_HOPS',
  ] as const)('fails production startup when %s is missing', (key) => {
    const environment = { ...PRODUCTION_ENVIRONMENT }
    delete environment[key]

    expect(() => resolveAuthConfig(environment)).toThrowError(
      expect.objectContaining<Partial<AuthConfigurationError>>({ key }),
    )
  })

  it.each([
    ['BETTER_AUTH_URL', 'http://hidden.philippeho.dev'],
    ['BETTER_AUTH_URL', 'not-a-url'],
    ['BETTER_AUTH_SECRET', 'too-short'],
    ['AUTH_EMAIL_FROM', 'not-an-email'],
    ['ALLOWED_ORIGINS', 'https://hidden.philippeho.dev,not-an-origin'],
    ['TRUST_PROXY_HOPS', '0'],
    ['TRUST_PROXY_HOPS', 'one'],
  ] as const)('rejects invalid production %s', (key, value) => {
    expect(() =>
      resolveAuthConfig({ ...PRODUCTION_ENVIRONMENT, [key]: value }),
    ).toThrowError(
      expect.objectContaining<Partial<AuthConfigurationError>>({ key }),
    )
  })

  it('requires 32 secret characters even when fewer characters occupy many bytes', () => {
    expect(() =>
      resolveAuthConfig({
        ...PRODUCTION_ENVIRONMENT,
        BETTER_AUTH_SECRET: 'é'.repeat(31),
      }),
    ).toThrowError(
      expect.objectContaining<Partial<AuthConfigurationError>>({
        key: 'BETTER_AUTH_SECRET',
      }),
    )
  })

  it('returns normalized, typed inputs for the auth factory', () => {
    expect(
      resolveAuthConfig({
        ...PRODUCTION_ENVIRONMENT,
        ALLOWED_ORIGINS:
          ' https://hidden.philippeho.dev, https://preview.example ',
      }),
    ).toEqual({
      enabled: true,
      production: true,
      databaseUrl: 'postgresql://hidden:secret@postgres/hidden',
      baseURL: 'https://hidden.philippeho.dev',
      secret: '0123456789abcdef0123456789abcdef',
      resendApiKey: 're_test_only',
      emailFrom: 'Hidden <no-reply@philippeho.dev>',
      turnstileSecretKey: 'turnstile-test-only',
      allowedOrigins: [
        'https://hidden.philippeho.dev',
        'https://preview.example',
      ],
      trustProxyHops: 1,
    })
  })

  it('allows an explicit HTTP localhost URL for database-backed tests', () => {
    const environment: AuthEnvironment = {
      ...PRODUCTION_ENVIRONMENT,
      NODE_ENV: 'test',
      BETTER_AUTH_URL: 'http://127.0.0.1:8080',
      ALLOWED_ORIGINS: 'http://127.0.0.1:5173',
    }
    delete environment.TRUST_PROXY_HOPS

    expect(
      resolveAuthConfig(environment),
    ).toMatchObject({
      enabled: true,
      production: false,
      baseURL: 'http://127.0.0.1:8080',
      trustProxyHops: false,
    })
  })
})
