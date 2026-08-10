import express from 'express'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthenticatedUser } from '../auth/service'
import type { Logger } from '../logger'
import { createAdminRouter } from './http'
import type {
  AdminAccountPage,
  AdminMatchDetail,
  AdminMatchPage,
  AdminRepository,
  AdminRuntimeStatsProvider,
} from './repository'

const SESSION_TOKEN = 'A'.repeat(43)
const ADMIN: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'admin',
  username: 'PhilAdmin',
}
const PLAYER: AuthenticatedUser = {
  id: '00000000-0000-4000-8000-000000000002',
  role: 'player',
  username: 'PlayerOne',
}
const MATCH_ID = '00000000-0000-4000-8000-000000000101'
const COMPLETED_AT = Date.parse('2030-01-02T03:04:05.000Z')
const COMPLETED_CURSOR = '2030-01-02T03:04:05.000000Z'

const matchPage: AdminMatchPage = {
  items: [
    {
      matchId: MATCH_ID,
      completedAtMs: COMPLETED_AT,
      engine: { id: 'classic', revision: 1 },
      turnCount: 8,
      participants: [
        { seat: 0, accountId: ADMIN.id, username: ADMIN.username },
        { seat: 1, accountId: null, username: 'Guest#0001' },
      ],
      result: { scores: [5, 3], winner: 0 },
      bookmarkCount: 1,
    },
  ],
  nextCursor: { completedAt: COMPLETED_CURSOR, matchId: MATCH_ID },
}

const detail: AdminMatchDetail = {
  ...matchPage.items[0]!,
  schemaVersion: 1,
  config: { boardSize: 3 },
  boards: [
    { columns: 3, cells: [{ locationId: 0, symbol: 'rock' }] },
    { columns: 3, cells: [{ locationId: 0, symbol: null }] },
  ],
}

const accountPage: AdminAccountPage = {
  items: [
    {
      id: ADMIN.id,
      username: ADMIN.username,
      role: 'admin',
      createdAtMs: Date.parse('2029-01-01T00:00:00.000Z'),
      lastSeenAtMs: null,
      activeSessionCount: 0,
      matchCount: 1,
    },
  ],
  nextCursor: null,
}

function repositoryDouble(): AdminRepository {
  return {
    async getStorageStats() {
      return { accounts: 2, activeSessions: 1, matches: 7 }
    },
    async listMatches() {
      return matchPage
    },
    async getMatch(matchId) {
      return matchId === MATCH_ID ? detail : undefined
    },
    async listAccounts() {
      return accountPage
    },
  }
}

const runtimeStats: AdminRuntimeStatsProvider = {
  getRuntimeStats() {
    return {
      connections: 4,
      onlinePlayers: 3,
      namedPlayers: 3,
      authenticatedPlayers: 1,
      guestPlayers: 2,
      queuedPlayers: 1,
      pendingLobbies: 1,
      activeMatches: 1,
    }
  },
}

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()))
        }),
    ),
  )
})

async function startRouter(options: {
  getSession?: (
    token: string | undefined,
  ) => Promise<AuthenticatedUser | undefined>
  repository?: AdminRepository
  logger?: Logger
}) {
  const app = express()
  app.use(
    '/api/admin',
    createAdminRouter({
      getSession:
        options.getSession ??
        (async (token) => (token === SESSION_TOKEN ? ADMIN : undefined)),
      repository: options.repository ?? repositoryDouble(),
      runtimeStats,
      logger: options.logger ?? (() => undefined),
      secureCookie: false,
    }),
  )
  const server = createServer(app)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing port.')
  return `http://127.0.0.1:${address.port}`
}

function sessionHeaders() {
  return { Cookie: `hidden_session=${SESSION_TOKEN}` }
}

describe('admin HTTP API', () => {
  it('requires an authenticated administrator and disables response caching', async () => {
    const guestUrl = await startRouter({})
    const guest = await fetch(`${guestUrl}/api/admin/stats`)

    expect(guest.status).toBe(401)
    expect(guest.headers.get('cache-control')).toBe('no-store')
    await expect(guest.json()).resolves.toEqual({
      error: {
        code: 'account_required',
        message: 'Sign in with an administrator account.',
      },
    })

    const playerUrl = await startRouter({
      getSession: async () => PLAYER,
    })
    const player = await fetch(`${playerUrl}/api/admin/stats`, {
      headers: sessionHeaders(),
    })
    expect(player.status).toBe(403)
    await expect(player.json()).resolves.toEqual({
      error: {
        code: 'admin_required',
        message: 'Administrator access is required.',
      },
    })
  })

  it('returns one captured stats snapshot without performance telemetry', async () => {
    const baseUrl = await startRouter({})
    const response = await fetch(`${baseUrl}/api/admin/stats`, {
      headers: sessionHeaders(),
    })
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      runtime: runtimeStats.getRuntimeStats(),
      storage: { accounts: 2, activeSessions: 1, matches: 7 },
    })
    expect(body.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(JSON.stringify(body)).not.toMatch(/fps|frame|memory|cpu/i)
  })

  it('lists and opens global match snapshots with ISO dates and opaque cursors', async () => {
    const calls: unknown[] = []
    const repository = repositoryDouble()
    repository.listMatches = async (options) => {
      calls.push(options)
      return matchPage
    }
    const baseUrl = await startRouter({ repository })

    const first = await fetch(`${baseUrl}/api/admin/matches?q=Guest`, {
      headers: sessionHeaders(),
    })
    const firstBody = (await first.json()) as {
      items: Array<{ completedAt: string }>
      nextCursor: string
    }
    const second = await fetch(
      `${baseUrl}/api/admin/matches?cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      { headers: sessionHeaders() },
    )
    const guestExact = await fetch(
      `${baseUrl}/api/admin/matches?q=${encodeURIComponent('Guest#0001')}`,
      { headers: sessionHeaders() },
    )
    const found = await fetch(`${baseUrl}/api/admin/matches/${MATCH_ID}`, {
      headers: sessionHeaders(),
    })

    expect(first.status).toBe(200)
    expect(firstBody.items[0]?.completedAt).toBe(
      '2030-01-02T03:04:05.000Z',
    )
    expect(second.status).toBe(200)
    expect(guestExact.status).toBe(200)
    expect(calls).toEqual([
      { limit: 50, query: 'guest' },
      { limit: 50, cursor: matchPage.nextCursor },
      { limit: 50, query: 'guest#0001' },
    ])
    expect(found.status).toBe(200)
    await expect(found.json()).resolves.toMatchObject({
      match: {
        matchId: MATCH_ID,
        completedAt: '2030-01-02T03:04:05.000Z',
        boards: detail.boards,
      },
    })
  })

  it('lists safe account metadata without credential material', async () => {
    const baseUrl = await startRouter({})
    const response = await fetch(`${baseUrl}/api/admin/accounts?q=Phil`, {
      headers: sessionHeaders(),
    })
    const body = await response.json()
    const encoded = JSON.stringify(body)

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      items: [
        {
          username: 'PhilAdmin',
          role: 'admin',
          createdAt: '2029-01-01T00:00:00.000Z',
          lastSeenAt: null,
        },
      ],
    })
    expect(encoded).not.toMatch(/password|token|hash/i)
  })

  it('rejects malformed queries and maps missing records and repository failures', async () => {
    const repository = repositoryDouble()
    repository.getMatch = async () => undefined
    const baseUrl = await startRouter({ repository })
    const malformed = await fetch(`${baseUrl}/api/admin/matches?q=${'x'.repeat(65)}`, {
      headers: sessionHeaders(),
    })
    const missing = await fetch(`${baseUrl}/api/admin/matches/${MATCH_ID}`, {
      headers: sessionHeaders(),
    })

    expect(malformed.status).toBe(400)
    expect(missing.status).toBe(404)

    const failedUrl = await startRouter({
      repository: {
        ...repositoryDouble(),
        async getStorageStats() {
          throw new Error('database password must not escape')
        },
      },
    })
    const failed = await fetch(`${failedUrl}/api/admin/stats`, {
      headers: sessionHeaders(),
    })
    expect(failed.status).toBe(503)
    expect(await failed.text()).not.toContain('database password')
  })

  it('rejects structurally valid cursors containing impossible timestamps', async () => {
    const impossibleCursor = Buffer.from(
      JSON.stringify([
        'match',
        '2030-99-99T99:99:99.999999Z',
        MATCH_ID,
      ]),
      'utf8',
    ).toString('base64url')
    const baseUrl = await startRouter({})
    const response = await fetch(
      `${baseUrl}/api/admin/matches?cursor=${encodeURIComponent(impossibleCursor)}`,
      { headers: sessionHeaders() },
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'invalid_input' },
    })
  })
})
