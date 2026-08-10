// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminClient } from '../../admin/adminClient'
import type {
  AdminAccountSummary,
  AdminCursorPage,
  AdminMatchDetail,
  AdminMatchSummary,
  AdminStats,
} from '../../admin/types'
import { AdminPanel } from '../AdminPanel'

const stats: AdminStats = {
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

const match: AdminMatchSummary = {
  matchId: '00000000-0000-4000-8000-000000000101',
  completedAt: '2030-01-01T00:00:00.000Z',
  engine: { id: 'classic', revision: 1 },
  turnCount: 4,
  participants: [
    { seat: 0, accountId: '00000000-0000-4000-8000-000000000001', username: 'PhilAdmin' },
    { seat: 1, accountId: null, username: 'Guest#1234' },
  ],
  result: { scores: [3, 1], winner: 0 },
  bookmarkCount: 1,
}

const matchDetail: AdminMatchDetail = {
  ...match,
  schemaVersion: 1,
  config: { boardSize: 1 },
  boards: [
    { columns: 1, cells: [{ locationId: 0, symbol: 'rock' }] },
    { columns: 1, cells: [{ locationId: 0, symbol: null }] },
  ],
}

const account: AdminAccountSummary = {
  id: '00000000-0000-4000-8000-000000000001',
  username: 'PhilAdmin',
  role: 'admin',
  createdAt: '2029-01-01T00:00:00.000Z',
  lastSeenAt: '2030-01-01T00:00:00.000Z',
  activeSessionCount: 1,
  matchCount: 4,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, reject, resolve }
}

function clientDouble(): AdminClient {
  return {
    getStats: vi.fn(async () => stats),
    listMatches: vi.fn(async () => ({ items: [], nextCursor: null })),
    getMatch: vi.fn(async () => {
      throw new Error('No selected match.')
    }),
    listAccounts: vi.fn(async () => ({ items: [], nextCursor: null })),
  }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value() {
      this.setAttribute('open', '')
    },
  })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value() {
      this.removeAttribute('open')
    },
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.useRealTimers()
})

function panel(client: AdminClient, options: { open?: boolean; onClose?: () => void; onSessionExpired?: () => void } = {}) {
  return createElement(AdminPanel, {
    open: options.open ?? true,
    client,
    onClose: options.onClose ?? (() => undefined),
    onSessionExpired: options.onSessionExpired ?? (() => undefined),
  })
}

describe('AdminPanel', () => {
  it('opens as a labelled native dialog with a keyboard-ready top tablist', async () => {
    await act(async () => root.render(panel(clientDouble())))

    const dialog = container.querySelector('dialog')
    const tabs = [...container.querySelectorAll('[role="tab"]')]
    expect(dialog?.getAttribute('open')).toBe('')
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Stats',
      'Matches',
      'Accounts',
      'Console',
    ])
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]?.getAttribute('tabindex')).toBe('0')
    expect(tabs[1]?.getAttribute('tabindex')).toBe('-1')
  })

  it('polls stats every ten seconds only while the open Stats tab is mounted', async () => {
    const client = clientDouble()
    await act(async () => root.render(panel(client)))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    expect(client.getStats).toHaveBeenCalledOnce()

    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(client.getStats).toHaveBeenCalledTimes(2)

    await act(async () => root.render(panel(client, { open: false })))
    await act(async () => vi.advanceTimersByTimeAsync(20_000))
    expect(client.getStats).toHaveBeenCalledTimes(2)
  })

  it('moves between tabs with arrow keys and links each tab to its panel', async () => {
    const client = clientDouble()
    await act(async () => root.render(panel(client)))
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]

    await act(async () => {
      tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })

    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(tabs[1])
    expect(tabs[1]!.getAttribute('aria-controls')).toBe(
      container.querySelector('[role="tabpanel"]')?.id,
    )
    expect(client.listMatches).toHaveBeenCalledOnce()
  })

  it('selects a workbench match and returns from phone detail mode without playback controls', async () => {
    const client = clientDouble()
    client.listMatches = vi.fn(async () => ({ items: [match], nextCursor: null }))
    client.getMatch = vi.fn(async () => matchDetail)
    await act(async () => root.render(panel(client)))
    const matchesTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === 'Matches')!

    await act(async () => matchesTab.click())

    expect(client.getMatch).not.toHaveBeenCalled()
    expect(container.querySelector('.admin-workbench')?.className).not.toContain('admin-match-detail-open')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.admin-match-table tbody button')!.click()
    })
    expect(client.getMatch).toHaveBeenCalledWith(match.matchId)
    expect(container.querySelector('.admin-workbench')?.className).toContain('admin-match-detail-open')
    expect(container.textContent).toContain('Rules snapshot')
    expect(container.textContent).not.toContain('Play replay')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.admin-match-table tbody button')!.click()
    })
    expect(client.getMatch).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('Rules snapshot')
    expect(container.querySelector('.admin-loading')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.admin-mobile-back')!.click()
    })
    expect(container.querySelector('.admin-workbench')?.className).not.toContain('admin-match-detail-open')
  })

  it('shows a loading skeleton and turns service failures into retryable states', async () => {
    const client = clientDouble()
    let resolveStats: ((value: AdminStats) => void) | undefined
    client.getStats = vi.fn(() => new Promise<AdminStats>((resolve) => { resolveStats = resolve }))
    await act(async () => root.render(panel(client)))
    expect(container.querySelector('.admin-loading')).not.toBeNull()

    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => resolveStats?.(stats))
    client.getStats = vi.fn()
      .mockRejectedValueOnce(new Error('Database unavailable.'))
      .mockResolvedValue(stats)
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(container.textContent).toContain('Refresh failed: Database unavailable.')

    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    expect(container.textContent).not.toContain('Refresh failed:')
  })

  it('does not append an older page after a newer search has replaced the match list', async () => {
    const client = clientDouble()
    const older = deferred<AdminCursorPage<AdminMatchSummary>>()
    const newMatch: AdminMatchSummary = {
      ...match,
      matchId: '00000000-0000-4000-8000-000000000202',
      participants: [
        { ...match.participants[0], username: 'NewResult' },
        match.participants[1],
      ],
    }
    const staleMatch: AdminMatchSummary = {
      ...match,
      matchId: '00000000-0000-4000-8000-000000000303',
      participants: [
        { ...match.participants[0], username: 'StaleResult' },
        match.participants[1],
      ],
    }
    client.listMatches = vi.fn(async (options = {}) => {
      if (options.query === 'new') return { items: [newMatch], nextCursor: null }
      if (options.cursor === 'older') return older.promise
      return { items: [match], nextCursor: 'older' }
    })
    await act(async () => root.render(panel(client)))
    const matchesTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === 'Matches')!
    await act(async () => matchesTab.click())

    await act(async () => container.querySelector<HTMLButtonElement>('.admin-load-more')!.click())
    const input = container.querySelector<HTMLInputElement>('.admin-search input')!
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      valueSetter.call(input, 'new')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.admin-search button')!.click())
    expect(container.textContent).toContain('NewResult')

    await act(async () => older.resolve({ items: [staleMatch], nextCursor: null }))
    expect(container.textContent).toContain('NewResult')
    expect(container.textContent).not.toContain('StaleResult')
  })

  it('does not restore stale match detail after a search replaces the selection', async () => {
    const client = clientDouble()
    const oldDetail = deferred<AdminMatchDetail>()
    const newMatch = {
      ...match,
      matchId: '00000000-0000-4000-8000-000000000202',
    }
    client.listMatches = vi.fn(async (options = {}) => (
      options.query === 'new'
        ? { items: [newMatch], nextCursor: null }
        : { items: [match], nextCursor: null }
    ))
    client.getMatch = vi.fn(() => oldDetail.promise)
    await act(async () => root.render(panel(client)))
    const matchesTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === 'Matches')!
    await act(async () => matchesTab.click())
    await act(async () => container.querySelector<HTMLButtonElement>('.admin-match-table tbody button')!.click())

    const input = container.querySelector<HTMLInputElement>('.admin-search input')!
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      valueSetter.call(input, 'new')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.admin-search button')!.click())
    expect(container.textContent).toContain('Select a match')

    await act(async () => oldDetail.resolve(matchDetail))
    expect(container.textContent).toContain('Select a match')
    expect(container.textContent).not.toContain('Rules snapshot')
  })

  it('does not append an older account page after a newer search', async () => {
    const client = clientDouble()
    const older = deferred<AdminCursorPage<AdminAccountSummary>>()
    const newAccount = { ...account, id: '00000000-0000-4000-8000-000000000002', username: 'NewAdmin' }
    const staleAccount = { ...account, id: '00000000-0000-4000-8000-000000000003', username: 'StaleAdmin' }
    client.listAccounts = vi.fn(async (options = {}) => {
      if (options.query === 'new') return { items: [newAccount], nextCursor: null }
      if (options.cursor === 'older') return older.promise
      return { items: [account], nextCursor: 'older' }
    })
    await act(async () => root.render(panel(client)))
    const accountsTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === 'Accounts')!
    await act(async () => accountsTab.click())
    await act(async () => container.querySelector<HTMLButtonElement>('.admin-load-more')!.click())

    const input = container.querySelector<HTMLInputElement>('.admin-search input')!
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      valueSetter.call(input, 'new')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => container.querySelector<HTMLButtonElement>('.admin-search button')!.click())
    expect(container.textContent).toContain('NewAdmin')

    await act(async () => older.resolve({ items: [staleAccount], nextCursor: null }))
    expect(container.textContent).toContain('NewAdmin')
    expect(container.textContent).not.toContain('StaleAdmin')
  })

  it('ignores an in-flight stats failure after the workspace closes', async () => {
    const client = clientDouble()
    const poll = deferred<AdminStats>()
    const expired = vi.fn()
    client.getStats = vi.fn()
      .mockResolvedValueOnce(stats)
      .mockImplementationOnce(() => poll.promise)
    await act(async () => root.render(panel(client, { onSessionExpired: expired })))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    await act(async () => vi.advanceTimersByTimeAsync(10_000))
    await act(async () => root.render(panel(client, { open: false, onSessionExpired: expired })))

    const error = new Error('Expired') as Error & { code: string }
    error.code = 'account_required'
    await act(async () => poll.reject(error))
    expect(expired).not.toHaveBeenCalled()
  })

  it('closes on cancel and reports expired sessions instead of leaving admin data open', async () => {
    const close = vi.fn()
    const expired = vi.fn()
    const client = clientDouble()
    client.getStats = vi.fn(async () => {
      const error = new Error('Expired') as Error & { code: string }
      error.code = 'account_required'
      throw error
    })
    await act(async () => root.render(panel(client, { onClose: close, onSessionExpired: expired })))
    await act(async () => vi.advanceTimersByTimeAsync(0))
    container.querySelector('dialog')?.dispatchEvent(
      new Event('cancel', { bubbles: true, cancelable: true }),
    )

    expect(expired).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })
})
