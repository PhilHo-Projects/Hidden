/** @vitest-environment jsdom */

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MatchHistoryScreen } from '../MatchHistory'
import {
  MatchHistoryApiError,
  type MatchHistoryClient,
} from '../../history/historyClient'
import type {
  MatchHistoryDetail,
  MatchHistoryPage,
  MatchHistorySummary,
} from '../../history/types'

const FIRST_ID = '00000000-0000-4000-8000-000000000101'
const SECOND_ID = '00000000-0000-4000-8000-000000000102'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle
    reject = fail
  })
  return { promise, reject, resolve }
}

function summary(
  matchId: string,
  opponentName: string,
  bookmarked = false,
): MatchHistorySummary {
  return {
    matchId,
    completedAt: '2030-01-01T00:00:00.000Z',
    opponentName,
    outcome: 'win',
    playerScore: 2,
    opponentScore: 1,
    bookmarked,
  }
}

function page(
  matches: MatchHistorySummary[],
  nextCursor: string | null = null,
): MatchHistoryPage {
  return {
    stats: {
      played: matches.length,
      wins: matches.length,
      losses: 0,
      ties: 0,
    },
    matches,
    nextCursor,
  }
}

function detail(matchId: string, opponentName: string): MatchHistoryDetail {
  return {
    matchId,
    completedAt: '2030-01-01T00:00:00.000Z',
    engine: { id: 'classic', revision: 1 },
    config: {},
    turnCount: 2,
    participants: [
      { seat: 0, username: 'Viewer' },
      { seat: 1, username: opponentName },
    ],
    result: { scores: [2, 1], winner: 0 },
    boards: [
      { columns: 1, cells: [{ locationId: 0, symbol: 'rock' }] },
      { columns: 1, cells: [{ locationId: 0, symbol: 'paper' }] },
    ],
    viewerSeat: 0,
    bookmarked: false,
  }
}

function client(
  overrides: Partial<MatchHistoryClient> = {},
): MatchHistoryClient {
  return {
    list: () => Promise.resolve(page([])),
    get: (matchId) => Promise.resolve(detail(matchId, 'Opponent')),
    setBookmarked: (_matchId, bookmarked) => Promise.resolve(bookmarked),
    ...overrides,
  }
}

describe('MatchHistoryScreen effects', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  function buttonByText(text: string) {
    const button = [...container.querySelectorAll('button')].find((candidate) =>
      candidate.textContent?.includes(text),
    )
    if (!button) throw new Error(`Button not found: ${text}`)
    return button
  }

  function buttonByLabel(label: string) {
    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${label}"]`,
    )
    if (!button) throw new Error(`Button not found: ${label}`)
    return button
  }

  async function click(button: HTMLButtonElement) {
    await act(async () => {
      button.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

  async function mount(historyClient: MatchHistoryClient, onSignIn = vi.fn()) {
    await act(async () => {
      root.render(
        createElement(MatchHistoryScreen, {
          client: historyClient,
          onSignIn,
        }),
      )
    })
  }

  it('ignores an older list response after the filter changes', async () => {
    const all = deferred<MatchHistoryPage>()
    const interesting = deferred<MatchHistoryPage>()
    const historyClient = client({
      list: (options = {}) =>
        options.bookmarkedOnly ? interesting.promise : all.promise,
    })
    await mount(historyClient)

    await click(buttonByText('Interesting'))
    await act(async () => {
      interesting.resolve(page([summary(SECOND_ID, 'Current opponent', true)]))
      await interesting.promise
    })
    expect(container.textContent).toContain('Current opponent')

    await act(async () => {
      all.resolve(page([summary(FIRST_ID, 'Stale opponent')]))
      await all.promise
    })
    expect(container.textContent).toContain('Current opponent')
    expect(container.textContent).not.toContain('Stale opponent')
    expect(buttonByText('Interesting').getAttribute('aria-pressed')).toBe('true')
  })

  it('uses the opaque cursor and ignores a late page after changing filters', async () => {
    const more = deferred<MatchHistoryPage>()
    const calls: Array<Parameters<MatchHistoryClient['list']>[0]> = []
    const historyClient = client({
      list: (options = {}) => {
        calls.push(options)
        if (options.cursor) return more.promise
        if (options.bookmarkedOnly) return Promise.resolve(page([]))
        return Promise.resolve(page([summary(FIRST_ID, 'First opponent')], 'cursor-1'))
      },
    })
    await mount(historyClient)

    await click(buttonByText('Load more'))
    expect(calls.at(-1)).toEqual({
      bookmarkedOnly: false,
      cursor: 'cursor-1',
    })
    await click(buttonByText('Interesting'))
    expect(container.textContent).toContain('Nothing marked Interesting yet')

    await act(async () => {
      more.resolve(page([summary(SECOND_ID, 'Late page opponent')]))
      await more.promise
    })
    expect(container.textContent).not.toContain('First opponent')
    expect(container.textContent).not.toContain('Late page opponent')
  })

  it('keeps a newer match detail when an older request resolves last', async () => {
    const firstDetail = deferred<MatchHistoryDetail>()
    const secondDetail = deferred<MatchHistoryDetail>()
    const historyClient = client({
      list: () =>
        Promise.resolve(
          page([
            summary(FIRST_ID, 'First opponent'),
            summary(SECOND_ID, 'Second opponent'),
          ]),
        ),
      get: (matchId) =>
        matchId === FIRST_ID ? firstDetail.promise : secondDetail.promise,
    })
    await mount(historyClient)

    await click(buttonByLabel('View match against First opponent'))
    await click(buttonByText('All matches'))
    await click(buttonByLabel('View match against Second opponent'))
    await act(async () => {
      secondDetail.resolve(detail(SECOND_ID, 'Current detail opponent'))
      await secondDetail.promise
    })
    expect(container.textContent).toContain('Current detail opponent')

    await act(async () => {
      firstDetail.resolve(detail(FIRST_ID, 'Stale detail opponent'))
      await firstDetail.promise
    })
    expect(container.textContent).toContain('Current detail opponent')
    expect(container.textContent).not.toContain('Stale detail opponent')
  })

  it('rolls back a failed bookmark and exposes session expiry recovery', async () => {
    const onSignIn = vi.fn()
    let attempts = 0
    const historyClient = client({
      list: () => Promise.resolve(page([summary(FIRST_ID, 'Bookmark opponent')])),
      setBookmarked: async () => {
        attempts += 1
        throw new MatchHistoryApiError(
          attempts === 1 ? 'history_unavailable' : 'account_required',
          'not saved',
        )
      },
    })
    await mount(historyClient, onSignIn)

    const label = 'Bookmark match against Bookmark opponent as Interesting'
    await click(buttonByLabel(label))
    await vi.waitFor(() => {
      expect(buttonByLabel(label).getAttribute('aria-pressed')).toBe('false')
      expect(container.textContent).toContain('Bookmark was not saved. Try again.')
    })

    await click(buttonByLabel(label))
    await vi.waitFor(() => {
      expect(container.textContent).toContain('Your session expired')
    })
    await click(buttonByText('Sign in again'))
    expect(onSignIn).toHaveBeenCalledOnce()
  })
})
