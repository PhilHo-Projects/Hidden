import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MatchHistoryView } from '../MatchHistory'
import { initialHistoryState, type HistoryState } from '../../history/historyState'
import type { MatchHistoryDetail, MatchHistorySummary } from '../../history/types'

const MATCH_ID = '00000000-0000-4000-8000-000000000101'

const row: MatchHistorySummary = {
  matchId: MATCH_ID,
  completedAt: '2030-01-01T00:00:00.000Z',
  opponentName: 'Wooshylooshy',
  outcome: 'win',
  playerScore: 2,
  opponentScore: 1,
  bookmarked: false,
}

const detail: MatchHistoryDetail = {
  matchId: MATCH_ID,
  completedAt: row.completedAt,
  engine: { id: 'classic', revision: 1 },
  config: {},
  turnCount: 7,
  participants: [
    { seat: 0, username: 'Ecco' },
    { seat: 1, username: 'Wooshylooshy' },
  ],
  result: { scores: [2, 1], winner: 0 },
  boards: [
    {
      columns: 2,
      cells: [
        { locationId: 0, symbol: 'rock' },
        { locationId: 1, symbol: 'future-symbol' },
      ],
    },
    {
      columns: 2,
      cells: [
        { locationId: 0, symbol: 'paper' },
        { locationId: 1, symbol: null },
      ],
    },
  ],
  viewerSeat: 0,
  bookmarked: true,
}

const callbacks = {
  onSelectFilter: () => undefined,
  onRetryList: () => undefined,
  onLoadMore: () => undefined,
  onOpenDetail: () => undefined,
  onCloseDetail: () => undefined,
  onRetryDetail: () => undefined,
  onBookmark: () => undefined,
  onSignIn: () => undefined,
}

function render(state: HistoryState) {
  return renderToStaticMarkup(
    createElement(MatchHistoryView, { state, ...callbacks }),
  )
}

describe('MatchHistoryView', () => {
  it('renders a quiet loading skeleton before history arrives', () => {
    const markup = render(initialHistoryState)

    expect(markup).toContain('aria-busy="true"')
    expect(markup).toContain('history-skeleton-row')
    expect(markup).not.toContain('No matches yet')
  })

  it('shows totals, filters, newest rows, and a load-more control', () => {
    const markup = render({
      ...initialHistoryState,
      listStatus: 'ready',
      stats: { played: 3, wins: 1, losses: 1, ties: 1 },
      matches: [row],
      nextCursor: 'next-page',
    })

    expect(markup).toContain('Played')
    expect(markup).toContain('Wins')
    expect(markup).toContain('All matches')
    expect(markup).toContain('Interesting')
    expect(markup).toContain('Wooshylooshy')
    expect(markup).toContain('2–1')
    expect(markup).toContain('Load more')
    expect(markup).toContain(`View match against Wooshylooshy`)
    expect(markup).toContain(`Bookmark match against Wooshylooshy`)
  })

  it('teaches the difference between empty history and empty bookmarks', () => {
    const allEmpty = render({ ...initialHistoryState, listStatus: 'ready' })
    const interestingEmpty = render({
      ...initialHistoryState,
      filter: 'interesting',
      listStatus: 'ready',
    })

    expect(allEmpty).toContain('No completed online matches yet')
    expect(interestingEmpty).toContain('Nothing marked Interesting yet')
  })

  it('offers distinct expired-session and retryable-error recovery', () => {
    const expired = render({ ...initialHistoryState, listStatus: 'expired' })
    const failed = render({ ...initialHistoryState, listStatus: 'error' })

    expect(expired).toContain('Your session expired')
    expect(expired).toContain('Sign in again')
    expect(failed).toContain('History could not be loaded')
    expect(failed).toContain('Try again')
  })

  it('renders both final boards and preserves an unknown symbol as text', () => {
    const markup = render({
      ...initialHistoryState,
      listStatus: 'ready',
      stats: { played: 1, wins: 1, losses: 0, ties: 0 },
      matches: [row],
      selectedMatchId: MATCH_ID,
      detailStatus: 'ready',
      detail,
    })

    expect(markup).toContain('Ecco')
    expect(markup).toContain('Wooshylooshy')
    expect(markup).toContain('Final boards')
    expect(markup).toContain('future-symbol')
    expect(markup).toContain('Remove Interesting bookmark')
    expect(markup).not.toContain('accountId')
  })

  it('keeps the optimistic bookmark error beside the affected match', () => {
    const markup = render({
      ...initialHistoryState,
      listStatus: 'ready',
      matches: [row],
      bookmarkErrors: [MATCH_ID],
    })

    expect(markup).toContain('Bookmark was not saved. Try again.')
  })
})
