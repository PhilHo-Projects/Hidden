import { describe, expect, it } from 'vitest'
import { historyReducer, initialHistoryState } from './historyState'
import type { MatchHistoryDetail, MatchHistoryPage } from './types'

const MATCH_ID = '00000000-0000-4000-8000-000000000101'

const page: MatchHistoryPage = {
  stats: { played: 3, wins: 1, losses: 1, ties: 1 },
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
  nextCursor: 'next-page',
}

const detail: MatchHistoryDetail = {
  matchId: MATCH_ID,
  completedAt: '2030-01-01T00:00:00.000Z',
  engine: { id: 'classic', revision: 1 },
  config: {},
  turnCount: 2,
  participants: [
    { seat: 0, username: 'Ecco' },
    { seat: 1, username: 'Friend' },
  ],
  result: { scores: [2, 1], winner: 0 },
  boards: [
    { columns: 1, cells: [{ locationId: 0, symbol: 'rock' }] },
    { columns: 1, cells: [{ locationId: 0, symbol: null }] },
  ],
  viewerSeat: 0,
  bookmarked: false,
}

describe('history state', () => {
  it('replaces rows when a filter load succeeds and appends a later page', () => {
    const loaded = historyReducer(initialHistoryState, {
      type: 'list-loaded',
      page,
      append: false,
    })
    const appended = historyReducer(
      historyReducer(loaded, { type: 'more-started' }),
      {
        type: 'list-loaded',
        page: {
          ...page,
          matches: [
            {
              ...page.matches[0],
              matchId: '00000000-0000-4000-8000-000000000102',
            },
          ],
          nextCursor: null,
        },
        append: true,
      },
    )

    expect(appended.listStatus).toBe('ready')
    expect(appended.matches.map((match) => match.matchId)).toEqual([
      MATCH_ID,
      '00000000-0000-4000-8000-000000000102',
    ])
    expect(appended.loadingMore).toBe(false)
    expect(appended.nextCursor).toBeNull()
  })

  it('clears stale rows immediately when switching filters', () => {
    const loaded = historyReducer(initialHistoryState, {
      type: 'list-loaded',
      page,
      append: false,
    })

    const filtered = historyReducer(loaded, {
      type: 'filter-selected',
      filter: 'interesting',
    })

    expect(filtered.filter).toBe('interesting')
    expect(filtered.listStatus).toBe('loading')
    expect(filtered.matches).toEqual([])
    expect(filtered.detail).toBeNull()
  })

  it('rolls an optimistic bookmark back without losing the loaded detail', () => {
    const loaded = historyReducer(
      historyReducer(initialHistoryState, {
        type: 'list-loaded',
        page,
        append: false,
      }),
      { type: 'detail-loaded', detail },
    )
    const optimistic = historyReducer(loaded, {
      type: 'bookmark-started',
      matchId: MATCH_ID,
      bookmarked: true,
    })
    const rolledBack = historyReducer(optimistic, {
      type: 'bookmark-failed',
      matchId: MATCH_ID,
      bookmarked: false,
    })

    expect(optimistic.matches[0]?.bookmarked).toBe(true)
    expect(optimistic.detail?.bookmarked).toBe(true)
    expect(rolledBack.matches[0]?.bookmarked).toBe(false)
    expect(rolledBack.detail?.bookmarked).toBe(false)
    expect(rolledBack.pendingBookmarks).not.toContain(MATCH_ID)
    expect(rolledBack.bookmarkErrors).toContain(MATCH_ID)
  })

  it('removes a successfully unbookmarked row from the Interesting filter', () => {
    const interestingPage = {
      ...page,
      matches: [{ ...page.matches[0], bookmarked: true }],
    }
    const loaded = historyReducer(
      historyReducer(initialHistoryState, {
        type: 'filter-selected',
        filter: 'interesting',
      }),
      { type: 'list-loaded', page: interestingPage, append: false },
    )
    const optimistic = historyReducer(loaded, {
      type: 'bookmark-started',
      matchId: MATCH_ID,
      bookmarked: false,
    })
    const saved = historyReducer(optimistic, {
      type: 'bookmark-saved',
      matchId: MATCH_ID,
      bookmarked: false,
    })

    expect(optimistic.matches).toHaveLength(1)
    expect(saved.matches).toHaveLength(0)
  })

  it('keeps existing rows when loading more fails', () => {
    const loaded = historyReducer(initialHistoryState, {
      type: 'list-loaded',
      page,
      append: false,
    })
    const failed = historyReducer(
      historyReducer(loaded, { type: 'more-started' }),
      { type: 'more-failed' },
    )

    expect(failed.matches).toEqual(page.matches)
    expect(failed.listStatus).toBe('ready')
    expect(failed.moreError).toBe(true)
  })

  it('shows session expiry inside an open detail after a bookmark request', () => {
    const openDetail = historyReducer(initialHistoryState, {
      type: 'detail-loaded',
      detail,
    })

    const expired = historyReducer(openDetail, { type: 'session-expired' })

    expect(expired.listStatus).toBe('expired')
    expect(expired.detailStatus).toBe('expired')
    expect(expired.selectedMatchId).toBe(MATCH_ID)
  })
})
