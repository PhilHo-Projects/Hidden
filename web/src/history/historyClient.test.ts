import { describe, expect, it } from 'vitest'
import {
  createMatchHistoryClient,
  MatchHistoryApiError,
} from './historyClient'

const MATCH_ID = '00000000-0000-4000-8000-000000000101'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const listBody = {
  stats: { played: 1, wins: 1, losses: 0, ties: 0 },
  matches: [
    {
      matchId: MATCH_ID,
      completedAt: '2030-01-01T00:00:00.000Z',
      opponentName: 'Friend',
      outcome: 'win',
      playerScore: 2,
      opponentScore: 1,
      bookmarked: false,
    },
  ],
  nextCursor: 'opaque-cursor',
}

describe('match history client', () => {
  it('requests and validates a filtered cursor page', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const client = createMatchHistoryClient(async (input, init) => {
      requests.push({ url: String(input), init })
      return jsonResponse(listBody)
    })

    const result = await client.list({
      bookmarkedOnly: true,
      cursor: 'opaque cursor',
    })

    expect(requests).toEqual([
      {
        url: '/api/history?bookmarked=true&cursor=opaque+cursor',
        init: { headers: { Accept: 'application/json' } },
      },
    ])
    expect(result).toEqual(listBody)
  })

  it('keeps unknown historical symbols as displayable strings', async () => {
    const client = createMatchHistoryClient(async () =>
      jsonResponse({
        match: {
          matchId: MATCH_ID,
          completedAt: '2030-01-01T00:00:00.000Z',
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
            {
              columns: 3,
              cells: [{ locationId: 0, symbol: null }],
            },
          ],
          viewerSeat: 0,
          bookmarked: false,
        },
      }),
    )

    const detail = await client.get(MATCH_ID)

    expect(detail.boards[0]?.cells[0]?.symbol).toBe('future-symbol')
  })

  it('sends an idempotent bookmark value as JSON', async () => {
    const requests: Array<{ url: string; init: RequestInit | undefined }> = []
    const client = createMatchHistoryClient(async (input, init) => {
      requests.push({ url: String(input), init })
      return jsonResponse({ bookmarked: true })
    })

    await expect(client.setBookmarked(MATCH_ID, true)).resolves.toBe(true)
    expect(requests).toEqual([
      {
        url: `/api/history/${MATCH_ID}/bookmark`,
        init: {
          method: 'PUT',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: '{"bookmarked":true}',
        },
      },
    ])
  })

  it('distinguishes an expired account session from retryable failures', async () => {
    const accountClient = createMatchHistoryClient(async () =>
      jsonResponse(
        {
          error: {
            code: 'account_required',
            message: 'Sign in to view match history.',
          },
        },
        401,
      ),
    )
    const unavailableClient = createMatchHistoryClient(async () => {
      throw new Error('network detail')
    })

    await expect(accountClient.list()).rejects.toMatchObject({
      name: 'MatchHistoryApiError',
      code: 'account_required',
    })
    await expect(unavailableClient.list()).rejects.toEqual(
      new MatchHistoryApiError(
        'history_unavailable',
        'Match history is temporarily unavailable.',
      ),
    )
  })

  it('rejects malformed successful payloads as unavailable data', async () => {
    const client = createMatchHistoryClient(async () =>
      jsonResponse({ stats: { played: 'many' }, matches: [] }),
    )

    await expect(client.list()).rejects.toMatchObject({
      code: 'history_unavailable',
    })
  })

  it('normalizes malformed error payloads as unavailable data', async () => {
    const client = createMatchHistoryClient(async () =>
      jsonResponse({ error: 'upstream proxy response' }, 503),
    )

    await expect(client.list()).rejects.toMatchObject({
      code: 'history_unavailable',
    })
  })
})
