import { makeSignature } from 'better-auth/crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDatabasePool } from '../database.js'
import { runMigrations } from '../migrations.js'
import type { EnabledAuthConfig } from './authConfig.js'
import { createHiddenAuth } from './betterAuth.js'
import { createSessionResolver } from './sessionResolver.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const describeDatabase = databaseUrl ? describe.sequential : describe.skip
const secret = '0123456789abcdef0123456789abcdef'

describeDatabase('Better Auth PostgreSQL session resolution', () => {
  const pool = createDatabasePool(databaseUrl!)
  const config: EnabledAuthConfig = {
    enabled: true,
    production: false,
    databaseUrl: databaseUrl!,
    baseURL: 'http://127.0.0.1:8080',
    secret,
    resendApiKey: 'unused',
    emailFrom: 'Hidden <no-reply@example.test>',
    turnstileSecretKey: 'unused',
    allowedOrigins: ['http://127.0.0.1:5173'],
    trustProxyHops: false,
  }
  const auth = createHiddenAuth({
    pool,
    config,
    emails: {
      async sendVerification() {},
      async sendPasswordReset() {},
      async sendEmailChange() {},
    },
  })
  const resolver = createSessionResolver(auth.api, {
    cookieName: 'hidden_session',
  })

  beforeAll(async () => runMigrations(pool))
  beforeEach(async () => {
    await pool.query('TRUNCATE TABLE users CASCADE')
    await pool.query(
      `INSERT INTO users (
         id, name, email, email_verified, display_username, username, role,
         created_at
       ) VALUES (
         '00000000-0000-4000-8000-000000000001', 'Player_ONE',
         'private@example.test', true, 'Player_ONE', 'player_one', 'admin', now()
       )`,
    )
    await pool.query(
      `INSERT INTO auth_sessions (id, token, user_id, expires_at)
       VALUES (
         '00000000-0000-4000-8000-000000000011', 'opaque-session',
         '00000000-0000-4000-8000-000000000001', now() + interval '1 hour'
       )`,
    )
  })
  afterAll(async () => pool.end())

  it('resolves a real signed Better Auth cookie through PostgreSQL and keeps email private', async () => {
    const signature = await makeSignature('opaque-session', secret)
    const identity = await resolver.resolve(
      new Headers({
        cookie: `hidden_session=opaque-session.${signature}`,
      }),
    )
    expect(identity).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      username: 'Player_ONE',
      role: 'admin',
    })
    expect(identity).not.toHaveProperty('email')
  })
})
