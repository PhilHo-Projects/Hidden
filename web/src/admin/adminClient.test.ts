import { describe, expect, it, vi } from 'vitest'
import { AdminApiError, createAdminClient } from './adminClient'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const statsBody = {
  capturedAt: '2030-01-01T00:00:00.000Z',
  runtime: {
    connections: 5,
    onlinePlayers: 4,
    namedPlayers: 4,
    authenticatedPlayers: 2,
    guestPlayers: 2,
    queuedPlayers: 1,
    pendingLobbies: 1,
    activeMatches: 1,
  },
  storage: { accounts: 8, activeSessions: 3, matches: 20 },
}

const summary = {
  matchId: '00000000-0000-4000-8000-000000000101',
  completedAt: '2030-01-02T03:04:05.000Z',
  engine: { id: 'classic', revision: 1 },
  turnCount: 8,
  participants: [
    {
      seat: 0,
      accountId: '00000000-0000-4000-8000-000000000001',
      username: 'PhilAdmin',
    },
    { seat: 1, accountId: null, username: 'Guest#0001' },
  ],
  result: { scores: [5, 3], winner: 0 },
  bookmarkCount: 1,
}

describe('admin client', () => {
  it('decodes the operational stats response', async () => {
    const fetcher = vi.fn(async () => jsonResponse(statsBody))
    const client = createAdminClient(fetcher as typeof fetch)

    await expect(client.getStats()).resolves.toEqual(statsBody)
    expect(fetcher).toHaveBeenCalledWith('/api/admin/stats', {
      headers: { Accept: 'application/json' },
    })
  })

  it('decodes match pages and detail while preserving opaque data snapshots', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [summary], nextCursor: 'opaque-cursor' }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          match: {
            ...summary,
            schemaVersion: 1,
            config: { futureRule: true },
            boards: [
              { columns: 3, cells: [{ locationId: 0, symbol: 'future' }] },
              { columns: 3, cells: [{ locationId: 0, symbol: null }] },
            ],
          },
        }),
      )
    const client = createAdminClient(fetcher as typeof fetch)

    const page = await client.listMatches({ query: 'guest', cursor: 'cursor' })
    const detail = await client.getMatch(summary.matchId)

    expect(page.items[0]).toEqual(summary)
    expect(detail.config).toEqual({ futureRule: true })
    expect(detail.boards[0].cells[0]?.symbol).toBe('future')
    expect(fetcher.mock.calls[0]?.[0]).toBe(
      '/api/admin/matches?q=guest&cursor=cursor',
    )
  })

  it('decodes safe account pages with nullable last-seen time', async () => {
    const account = {
      id: '00000000-0000-4000-8000-000000000001',
      username: 'PhilAdmin',
      role: 'admin',
      createdAt: '2029-01-01T00:00:00.000Z',
      lastSeenAt: null,
      activeSessionCount: 0,
      matchCount: 3,
    }
    const fetcher = vi.fn(async () =>
      jsonResponse({ items: [account], nextCursor: null }),
    )
    const client = createAdminClient(fetcher as typeof fetch)

    await expect(client.listAccounts({ query: 'phil' })).resolves.toEqual({
      items: [account],
      nextCursor: null,
    })
  })

  it('maps authorization errors and rejects malformed successful payloads', async () => {
    const denied = createAdminClient(
      (async () =>
        jsonResponse(
          {
            error: {
              code: 'admin_required',
              message: 'Administrator access is required.',
            },
          },
          403,
        )) as typeof fetch,
    )
    await expect(denied.getStats()).rejects.toEqual(
      new AdminApiError(
        'admin_required',
        'Administrator access is required.',
      ),
    )

    const malformed = createAdminClient(
      (async () => jsonResponse({ ...statsBody, capturedAt: 'yesterday' })) as typeof fetch,
    )
    await expect(malformed.getStats()).rejects.toMatchObject({
      code: 'admin_unavailable',
    })
  })
})
