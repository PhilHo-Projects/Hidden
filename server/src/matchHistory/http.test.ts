import express from 'express'
import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuthenticatedUser } from '../auth/service'
import type { Logger } from '../logger'
import type {
  ListMatchHistoryOptions,
  MatchHistoryDetail,
  MatchHistoryPage,
} from './repository'
import { createMatchHistoryRouter } from './http'

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000001'
const MATCH_ID = '00000000-0000-4000-8000-000000000101'
const SESSION_TOKEN = 'A'.repeat(43)

const user: AuthenticatedUser = {
  id: ACCOUNT_ID,
  role: 'player',
  username: 'Wooshylooshy',
}

const page: MatchHistoryPage = {
  stats: { played: 1, wins: 1, losses: 0, ties: 0 },
  matches: [
    {
      matchId: MATCH_ID,
      completedAtMs: Date.parse('2030-01-01T00:00:00.000Z'),
      opponentName: 'Friend',
      outcome: 'win',
      playerScore: 2,
      opponentScore: 1,
      bookmarked: false,
    },
  ],
  nextCursor: {
    completedAtMs: Date.parse('2029-12-31T00:00:00.000Z'),
    matchId: '00000000-0000-4000-8000-000000000099',
  },
}

const detail: MatchHistoryDetail = {
  matchId: MATCH_ID,
  completedAtMs: Date.parse('2030-01-01T00:00:00.000Z'),
  engine: { id: 'classic', revision: 2 },
  config: { boardSize: 3 },
  turnCount: 2,
  participants: [
    { seat: 0, username: 'Wooshylooshy' },
    { seat: 1, username: 'Friend' },
  ],
  result: { scores: [2, 1], winner: 0 },
  boards: [
    {
      columns: 3,
      cells: [{ locationId: 0, symbol: 'future-symbol' }],
    },
    { columns: 3, cells: [{ locationId: 0, symbol: null }] },
  ],
  viewerSeat: 0,
  bookmarked: false,
}

interface RepositoryDouble {
  listForAccount(
    accountId: string,
    options: ListMatchHistoryOptions,
  ): Promise<MatchHistoryPage>
  getForAccount(
    accountId: string,
    matchId: string,
  ): Promise<MatchHistoryDetail | undefined>
  setBookmarked(
    accountId: string,
    matchId: string,
    bookmarked: boolean,
  ): Promise<boolean>
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
  getSession?: (token: string | undefined) => Promise<AuthenticatedUser | undefined>
  repository?: RepositoryDouble
  logger?: Logger
}) {
  const app = express()
  app.use(
    '/api/history',
    createMatchHistoryRouter({
      allowedOrigins: ['http://localhost:5173'],
      getSession:
        options.getSession ??
        (async (token) => (token === SESSION_TOKEN ? user : undefined)),
      repository:
        options.repository ??
        {
          async listForAccount() {
            return page
          },
          async getForAccount() {
            return detail
          },
          async setBookmarked() {
            return true
          },
        },
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

describe('match history HTTP API', () => {
  it('requires a current account session and disables response caching', async () => {
    const baseUrl = await startRouter({})

    const response = await fetch(`${baseUrl}/api/history`)

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      error: {
        code: 'account_required',
        message: 'Sign in to view match history.',
      },
    })
  })

  it('returns ISO-dated summaries and decodes the opaque cursor for bookmarked pages', async () => {
    const calls: Array<{ accountId: string; options: ListMatchHistoryOptions }> = []
    const repository: RepositoryDouble = {
      async listForAccount(accountId, options) {
        calls.push({ accountId, options })
        return page
      },
      async getForAccount() {
        return detail
      },
      async setBookmarked() {
        return true
      },
    }
    const baseUrl = await startRouter({ repository })

    const first = await fetch(`${baseUrl}/api/history`, {
      headers: sessionHeaders(),
    })
    const firstBody = (await first.json()) as {
      matches: Array<{ completedAt: string }>
      nextCursor: string
    }
    const second = await fetch(
      `${baseUrl}/api/history?bookmarked=true&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      { headers: sessionHeaders() },
    )

    expect(first.status).toBe(200)
    expect(firstBody.matches[0]?.completedAt).toBe('2030-01-01T00:00:00.000Z')
    expect(second.status).toBe(200)
    expect(calls).toEqual([
      { accountId: ACCOUNT_ID, options: { limit: 20, bookmarkedOnly: false } },
      {
        accountId: ACCOUNT_ID,
        options: {
          limit: 20,
          bookmarkedOnly: true,
          cursor: page.nextCursor!,
        },
      },
    ])
  })

  it('rejects malformed list parameters before querying history', async () => {
    let queries = 0
    const baseUrl = await startRouter({
      repository: {
        async listForAccount() {
          queries += 1
          return page
        },
        async getForAccount() {
          return detail
        },
        async setBookmarked() {
          return true
        },
      },
    })

    const cursor = await fetch(`${baseUrl}/api/history?cursor=not-a-cursor`, {
      headers: sessionHeaders(),
    })
    const filter = await fetch(`${baseUrl}/api/history?bookmarked=sometimes`, {
      headers: sessionHeaders(),
    })

    expect(cursor.status).toBe(400)
    expect(filter.status).toBe(400)
    expect(queries).toBe(0)
  })

  it('returns detail to a participant and hides missing or unauthorized IDs', async () => {
    const repository: RepositoryDouble = {
      async listForAccount() {
        return page
      },
      async getForAccount(_accountId, matchId) {
        return matchId === MATCH_ID ? detail : undefined
      },
      async setBookmarked() {
        return true
      },
    }
    const baseUrl = await startRouter({ repository })

    const found = await fetch(`${baseUrl}/api/history/${MATCH_ID}`, {
      headers: sessionHeaders(),
    })
    const absent = await fetch(
      `${baseUrl}/api/history/00000000-0000-4000-8000-000000000999`,
      { headers: sessionHeaders() },
    )
    const malformed = await fetch(`${baseUrl}/api/history/not-a-uuid`, {
      headers: sessionHeaders(),
    })

    expect(found.status).toBe(200)
    await expect(found.json()).resolves.toMatchObject({
      match: {
        matchId: MATCH_ID,
        completedAt: '2030-01-01T00:00:00.000Z',
        boards: detail.boards,
      },
    })
    expect(absent.status).toBe(404)
    expect(malformed.status).toBe(404)
  })

  it('protects bookmark writes by origin, JSON shape, and participation', async () => {
    const mutations: boolean[] = []
    const repository: RepositoryDouble = {
      async listForAccount() {
        return page
      },
      async getForAccount() {
        return detail
      },
      async setBookmarked(_accountId, matchId, bookmarked) {
        mutations.push(bookmarked)
        return matchId === MATCH_ID
      },
    }
    const baseUrl = await startRouter({ repository })
    const request = (matchId: string, body: string, origin?: string) =>
      fetch(`${baseUrl}/api/history/${matchId}/bookmark`, {
        method: 'PUT',
        headers: {
          ...sessionHeaders(),
          'Content-Type': 'application/json',
          ...(origin ? { Origin: origin } : {}),
        },
        body,
      })

    expect((await request(MATCH_ID, '{"bookmarked":true}')).status).toBe(403)
    expect(
      (await request(MATCH_ID, '{"bookmarked":"yes"}', 'http://localhost:5173')).status,
    ).toBe(400)
    const success = await request(
      MATCH_ID,
      '{"bookmarked":true}',
      'http://localhost:5173',
    )
    const absent = await request(
      '00000000-0000-4000-8000-000000000999',
      '{"bookmarked":false}',
      'http://localhost:5173',
    )

    expect(success.status).toBe(200)
    await expect(success.json()).resolves.toEqual({ bookmarked: true })
    expect(absent.status).toBe(404)
    expect(mutations).toEqual([true, false])
  })

  it('contains repository failures behind a retryable response and safe log', async () => {
    const logs: Parameters<Logger>[] = []
    const baseUrl = await startRouter({
      logger: (...entry) => logs.push(entry),
      repository: {
        async listForAccount() {
          throw new TypeError('raw-database-message')
        },
        async getForAccount() {
          return detail
        },
        async setBookmarked() {
          return true
        },
      },
    })

    const response = await fetch(`${baseUrl}/api/history`, {
      headers: sessionHeaders(),
    })

    expect(response.status).toBe(503)
    expect(logs).toEqual([
      [
        'error',
        'match_history.request_failed',
        { operation: 'list', errorClass: 'TypeError' },
      ],
    ])
    expect(JSON.stringify(logs)).not.toContain('raw-database-message')
  })
})
