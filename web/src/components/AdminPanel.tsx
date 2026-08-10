import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  AdminApiError,
  type AdminClient,
} from '../admin/adminClient'
import { runAdminConsoleCommand } from '../admin/consoleCommands'
import type {
  AdminAccountSummary,
  AdminMatchBoard,
  AdminMatchDetail,
  AdminMatchSummary,
  AdminStats,
} from '../admin/types'

type AdminTab = 'stats' | 'matches' | 'accounts' | 'console'

const TABS: ReadonlyArray<{ id: AdminTab; label: string }> = [
  { id: 'stats', label: 'Stats' },
  { id: 'matches', label: 'Matches' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'console', label: 'Console' },
]

interface AdminPanelProps {
  open: boolean
  client: AdminClient
  onClose: () => void
  onSessionExpired: () => void
}

function isSessionError(error: unknown) {
  return (
    error instanceof AdminApiError ||
    (error instanceof Error && 'code' in error)
  ) &&
    ((error as { code?: unknown }).code === 'account_required' ||
      (error as { code?: unknown }).code === 'admin_required')
}

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The admin workspace is temporarily unavailable.'
}

function formatDate(value: string | null) {
  if (!value) return 'Never'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function shortId(value: string) {
  return value.slice(0, 8)
}

function StatBlock({ label, value, detail }: { label: string; value: number; detail?: string }) {
  return (
    <article className="admin-stat-block">
      <p>{label}</p>
      <strong>{value.toLocaleString()}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  )
}

function LoadingRows({ count = 5 }: { count?: number }) {
  return (
    <div className="admin-loading" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  )
}

function RetryState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="admin-state admin-state-error" role="alert">
      <strong>Could not load this view.</strong>
      <p>{message}</p>
      <button type="button" onClick={onRetry}>Try again</button>
    </div>
  )
}

function SearchBar({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <form
      className="admin-search"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <label>
        <span>{label}</span>
        <input
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button type="submit">Search</button>
    </form>
  )
}

function StatsView({
  stats,
  loading,
  error,
  onRetry,
}: {
  stats: AdminStats | null
  loading: boolean
  error: string | null
  onRetry: () => void
}) {
  if (loading && !stats) return <LoadingRows count={3} />
  if (error && !stats) return <RetryState message={error} onRetry={onRetry} />
  if (!stats) return null
  return (
    <section className="admin-stats" aria-labelledby="admin-stats-heading">
      <header className="admin-view-heading">
        <div>
          <p>Live service</p>
          <h3 id="admin-stats-heading">Current activity</h3>
        </div>
        <small>Updated {formatDate(stats.capturedAt)}</small>
      </header>
      {error ? <p className="admin-inline-warning">Refresh failed: {error}</p> : null}
      <div className="admin-stat-group">
        <StatBlock label="Online players" value={stats.runtime.onlinePlayers} detail={`${stats.runtime.namedPlayers} named · ${stats.runtime.authenticatedPlayers} signed in · ${stats.runtime.guestPlayers} guests`} />
        <StatBlock label="Connections" value={stats.runtime.connections} />
        <StatBlock label="Queued" value={stats.runtime.queuedPlayers} />
        <StatBlock label="Pending lobbies" value={stats.runtime.pendingLobbies} />
        <StatBlock label="Active matches" value={stats.runtime.activeMatches} />
      </div>
      <header className="admin-view-heading admin-storage-heading">
        <div>
          <p>PostgreSQL</p>
          <h3>Stored data</h3>
        </div>
      </header>
      <div className="admin-stat-group admin-stat-storage">
        <StatBlock label="Accounts" value={stats.storage.accounts} />
        <StatBlock label="Active sessions" value={stats.storage.activeSessions} />
        <StatBlock label="Match snapshots" value={stats.storage.matches} />
      </div>
      <p className="admin-data-note">Counts are operational snapshots. Stored matches contain final state only and cannot be replayed turn by turn.</p>
    </section>
  )
}

function BoardSnapshot({ board, label }: { board: AdminMatchBoard; label: string }) {
  return (
    <figure className="admin-board">
      <figcaption>{label}</figcaption>
      <div
        className="admin-board-grid"
        style={{ gridTemplateColumns: `repeat(${board.columns}, minmax(0, 1fr))` }}
      >
        {board.cells.map((cell) => (
          <span
            key={cell.locationId}
            className={`admin-board-cell admin-symbol-${cell.symbol ?? 'empty'}`}
            title={`${cell.locationId}: ${cell.symbol ?? 'empty'}`}
          >
            {cell.symbol?.slice(0, 1).toUpperCase() ?? ''}
          </span>
        ))}
      </div>
    </figure>
  )
}

function MatchInspector({
  detail,
  loading,
  error,
  onRetry,
  onBack,
}: {
  detail: AdminMatchDetail | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onBack: () => void
}) {
  if (loading) return <aside className="admin-inspector"><LoadingRows count={6} /></aside>
  if (error) return <aside className="admin-inspector"><RetryState message={error} onRetry={onRetry} /></aside>
  if (!detail) {
    return <aside className="admin-inspector admin-state"><strong>Select a match</strong><p>Choose a stored snapshot to inspect its final state.</p></aside>
  }
  const winner = detail.result.winner === null
    ? 'Tie'
    : detail.participants[detail.result.winner].username
  return (
    <aside className="admin-inspector" aria-label={`Match ${detail.matchId}`}>
      <button type="button" className="admin-mobile-back" onClick={onBack}>← All matches</button>
      <header className="admin-inspector-header">
        <div>
          <p>Snapshot {shortId(detail.matchId)}</p>
          <h3>{detail.participants[0].username} vs {detail.participants[1].username}</h3>
        </div>
        <span>{detail.result.scores[0]}–{detail.result.scores[1]}</span>
      </header>
      <dl className="admin-detail-grid">
        <div><dt>Winner</dt><dd>{winner}</dd></div>
        <div><dt>Completed</dt><dd>{formatDate(detail.completedAt)}</dd></div>
        <div><dt>Turns</dt><dd>{detail.turnCount}</dd></div>
        <div><dt>Bookmarks</dt><dd>{detail.bookmarkCount}</dd></div>
        <div><dt>Engine</dt><dd>{detail.engine.id} r{detail.engine.revision}</dd></div>
        <div><dt>Schema</dt><dd>v{detail.schemaVersion}</dd></div>
      </dl>
      <div className="admin-participants">
        {detail.participants.map((participant) => (
          <div key={participant.seat}>
            <strong>{participant.username}</strong>
            <span>{participant.accountId ? `Account ${shortId(participant.accountId)}` : 'Guest player'}</span>
          </div>
        ))}
      </div>
      <div className="admin-boards">
        <BoardSnapshot board={detail.boards[0]} label={detail.participants[0].username} />
        <BoardSnapshot board={detail.boards[1]} label={detail.participants[1].username} />
      </div>
      <details className="admin-rules">
        <summary>Rules snapshot</summary>
        <pre>{JSON.stringify(detail.config, null, 2)}</pre>
      </details>
    </aside>
  )
}

function MatchesView({ client, handleError }: { client: AdminClient; handleError: (error: unknown) => boolean }) {
  const listRequestRef = useRef(0)
  const detailRequestRef = useRef(0)
  const [items, setItems] = useState<AdminMatchSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminMatchDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const load = useCallback(async (append = false) => {
    const request = ++listRequestRef.current
    try {
      const page = await client.listMatches({ query: query || undefined, cursor: append ? cursor ?? undefined : undefined })
      if (request !== listRequestRef.current) return
      setItems((current) => append ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
      if (!append) {
        detailRequestRef.current += 1
        setDetail(null)
        setDetailError(null)
        setDetailLoading(false)
        setSelectedId(null)
      }
    } catch (caught) {
      if (request === listRequestRef.current && !handleError(caught)) setError(messageFor(caught))
    } finally {
      if (request === listRequestRef.current) setLoading(false)
    }
  }, [client, cursor, handleError, query])

  useEffect(() => {
    const request = ++listRequestRef.current
    let active = true
    void client
      .listMatches({ query: query || undefined })
      .then((page) => {
        if (!active || request !== listRequestRef.current) return
        setItems(page.items)
        setCursor(page.nextCursor)
        detailRequestRef.current += 1
        setDetail(null)
        setDetailError(null)
        setDetailLoading(false)
        setSelectedId(null)
      })
      .catch((caught: unknown) => {
        if (active && request === listRequestRef.current && !handleError(caught)) setError(messageFor(caught))
      })
      .finally(() => {
        if (active && request === listRequestRef.current) setLoading(false)
      })
    return () => { active = false }
  }, [client, handleError, query])

  const loadDetail = useCallback(async (matchId: string) => {
    const request = ++detailRequestRef.current
    try {
      const match = await client.getMatch(matchId)
      if (request === detailRequestRef.current) setDetail(match)
    } catch (caught) {
      if (request === detailRequestRef.current && !handleError(caught)) setDetailError(messageFor(caught))
    } finally {
      if (request === detailRequestRef.current) setDetailLoading(false)
    }
  }, [client, handleError])

  useEffect(() => {
    if (!selectedId) return
    const request = ++detailRequestRef.current
    let active = true
    void client
      .getMatch(selectedId)
      .then((match) => {
        if (active && request === detailRequestRef.current) setDetail(match)
      })
      .catch((caught: unknown) => {
        if (active && request === detailRequestRef.current && !handleError(caught)) setDetailError(messageFor(caught))
      })
      .finally(() => {
        if (active && request === detailRequestRef.current) setDetailLoading(false)
      })
    return () => { active = false }
  }, [client, handleError, selectedId])

  function beginLoad(append: boolean) {
    setLoading(true)
    setError(null)
    void load(append)
  }

  function selectMatch(matchId: string) {
    if (matchId === selectedId) return
    detailRequestRef.current += 1
    setDetail(null)
    setDetailLoading(true)
    setDetailError(null)
    setSelectedId(matchId)
  }

  function closeMobileDetail() {
    detailRequestRef.current += 1
    setSelectedId(null)
    setDetail(null)
    setDetailLoading(false)
    setDetailError(null)
  }

  return (
    <section className={`admin-workbench ${selectedId ? 'admin-match-detail-open' : ''}`}>
      <div className="admin-master-list">
        <SearchBar label="Find a match" placeholder="Exact match ID or username prefix" value={queryInput} onChange={setQueryInput} onSubmit={() => {
          const nextQuery = queryInput.trim()
          setLoading(true)
          setError(null)
          if (nextQuery === query) void load(false)
          else setQuery(nextQuery)
        }} />
        {error ? <RetryState message={error} onRetry={() => beginLoad(false)} /> : null}
        {!error && loading && items.length === 0 ? <LoadingRows /> : null}
        {!error && !loading && items.length === 0 ? <div className="admin-state"><strong>No match snapshots found.</strong><p>Try another player prefix or clear the search.</p></div> : null}
        {items.length > 0 ? (
          <div className="admin-table-wrap">
            <table className="admin-table admin-match-table">
              <thead><tr><th>Players</th><th>Score</th><th>Finished</th></tr></thead>
              <tbody>
                {items.map((match) => (
                  <tr key={match.matchId} className={selectedId === match.matchId ? 'is-selected' : undefined}>
                    <td><button type="button" onClick={() => selectMatch(match.matchId)}><strong>{match.participants[0].username}</strong><span>vs {match.participants[1].username} · {shortId(match.matchId)}</span></button></td>
                    <td>{match.result.scores[0]}–{match.result.scores[1]}</td>
                    <td>{formatDate(match.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {cursor ? <button className="admin-load-more" type="button" disabled={loading} onClick={() => beginLoad(true)}>{loading ? 'Loading…' : 'Load older'}</button> : null}
      </div>
      <MatchInspector detail={detail} loading={detailLoading} error={detailError} onRetry={() => {
        if (!selectedId) return
        setDetailLoading(true)
        setDetailError(null)
        void loadDetail(selectedId)
      }} onBack={closeMobileDetail} />
    </section>
  )
}

function AccountsView({ client, handleError }: { client: AdminClient; handleError: (error: unknown) => boolean }) {
  const listRequestRef = useRef(0)
  const [items, setItems] = useState<AdminAccountSummary[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [queryInput, setQueryInput] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (append = false) => {
    const request = ++listRequestRef.current
    try {
      const page = await client.listAccounts({ query: query || undefined, cursor: append ? cursor ?? undefined : undefined })
      if (request !== listRequestRef.current) return
      setItems((current) => append ? [...current, ...page.items] : page.items)
      setCursor(page.nextCursor)
    } catch (caught) {
      if (request === listRequestRef.current && !handleError(caught)) setError(messageFor(caught))
    } finally {
      if (request === listRequestRef.current) setLoading(false)
    }
  }, [client, cursor, handleError, query])

  useEffect(() => {
    const request = ++listRequestRef.current
    let active = true
    void client
      .listAccounts({ query: query || undefined })
      .then((page) => {
        if (!active || request !== listRequestRef.current) return
        setItems(page.items)
        setCursor(page.nextCursor)
      })
      .catch((caught: unknown) => {
        if (active && request === listRequestRef.current && !handleError(caught)) setError(messageFor(caught))
      })
      .finally(() => {
        if (active && request === listRequestRef.current) setLoading(false)
      })
    return () => { active = false }
  }, [client, handleError, query])

  function beginLoad(append: boolean) {
    setLoading(true)
    setError(null)
    void load(append)
  }

  return (
    <section className="admin-accounts">
      <SearchBar label="Find an account" placeholder="Username prefix" value={queryInput} onChange={setQueryInput} onSubmit={() => {
        const nextQuery = queryInput.trim()
        setLoading(true)
        setError(null)
        if (nextQuery === query) void load(false)
        else setQuery(nextQuery)
      }} />
      {error ? <RetryState message={error} onRetry={() => beginLoad(false)} /> : null}
      {!error && loading && items.length === 0 ? <LoadingRows /> : null}
      {!error && !loading && items.length === 0 ? <div className="admin-state"><strong>No accounts found.</strong><p>Try another username prefix or clear the search.</p></div> : null}
      {items.length > 0 ? (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Account</th><th>Role</th><th>Created</th><th>Last seen</th><th>Sessions</th><th>Matches</th></tr></thead>
            <tbody>{items.map((account) => <tr key={account.id}><td><strong>{account.username}</strong><span>{shortId(account.id)}</span></td><td><span className={`admin-role admin-role-${account.role}`}>{account.role}</span></td><td>{formatDate(account.createdAt)}</td><td>{formatDate(account.lastSeenAt)}</td><td>{account.activeSessionCount}</td><td>{account.matchCount}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
      {cursor ? <button className="admin-load-more" type="button" disabled={loading} onClick={() => beginLoad(true)}>{loading ? 'Loading…' : 'Load older'}</button> : null}
    </section>
  )
}

function ConsoleView({ client, handleError }: { client: AdminClient; handleError: (error: unknown) => boolean }) {
  const [input, setInput] = useState('')
  const [lines, setLines] = useState<string[]>([
    'Hidden admin console · safe command registry',
    'Type help to list available commands.',
  ])
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const command = input.trim()
    if (!command || busy) return
    setInput('')
    setBusy(true)
    try {
      const result = await runAdminConsoleCommand(command, client.getStats)
      setLines(result.action === 'clear' ? [] : (current) => [...current, `> ${command}`, ...result.lines])
    } catch (error) {
      if (!handleError(error)) setLines((current) => [...current, `> ${command}`, `Error: ${messageFor(error)}`])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-console" aria-label="Admin console">
      <div className="admin-console-output" role="log" aria-live="polite">
        {lines.length === 0 ? <span className="admin-console-muted">Console cleared.</span> : lines.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label htmlFor="admin-console-input">Command</label>
        <div><span aria-hidden="true">›</span><input id="admin-console-input" value={input} autoComplete="off" spellCheck={false} disabled={busy} onChange={(event) => setInput(event.target.value)} placeholder="help" /><button type="submit" disabled={busy || !input.trim()}>{busy ? 'Running…' : 'Run'}</button></div>
      </form>
      <p>No shell, SQL, eval, or destructive remote commands are available.</p>
    </section>
  )
}

function TabPanel({ active, children, id, labelledBy }: { active: boolean; children: ReactNode; id: string; labelledBy: string }) {
  if (!active) return null
  return <div className="admin-tab-panel" role="tabpanel" id={id} aria-labelledby={labelledBy}>{children}</div>
}

export function AdminPanel({ open, client, onClose, onSessionExpired }: AdminPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const closingRef = useRef(false)
  const statsRequestRef = useRef(0)
  const titleId = useId()
  const [wasOpen, setWasOpen] = useState(open)
  const [activeTab, setActiveTab] = useState<AdminTab>('stats')
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState<string | null>(null)

  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setActiveTab('stats')
  }

  const requestClose = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setActiveTab('stats')
    onClose()
  }, [onClose])

  const handleError = useCallback((error: unknown) => {
    if (!isSessionError(error)) return false
    onSessionExpired()
    requestClose()
    dialogRef.current?.close()
    return true
  }, [onSessionExpired, requestClose])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      closingRef.current = false
      if (!dialog.open) dialog.showModal()
    } else if (dialog.open) {
      dialog.close()
    }
  }, [open])

  const loadStats = useCallback(async () => {
    const request = ++statsRequestRef.current
    try {
      const nextStats = await client.getStats()
      if (request !== statsRequestRef.current) return
      setStats(nextStats)
      setStatsError(null)
    } catch (error) {
      if (request === statsRequestRef.current && !handleError(error)) {
        setStatsError(messageFor(error))
      }
    } finally {
      if (request === statsRequestRef.current) setStatsLoading(false)
    }
  }, [client, handleError])

  useEffect(() => {
    if (!open || activeTab !== 'stats') return
    const initialRefresh = window.setTimeout(() => void loadStats(), 0)
    const interval = window.setInterval(() => void loadStats(), 10_000)
    return () => {
      statsRequestRef.current += 1
      window.clearTimeout(initialRefresh)
      window.clearInterval(interval)
    }
  }, [activeTab, loadStats, open])

  function moveTab(event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) {
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!direction) return
    event.preventDefault()
    const nextIndex = (currentIndex + direction + TABS.length) % TABS.length
    setActiveTab(TABS[nextIndex]!.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <dialog
      ref={dialogRef}
      className="admin-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => { event.preventDefault(); requestClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) requestClose() }}
    >
      <div className="admin-shell">
        <header className="admin-header">
          <div className="admin-title">
            <span>Restricted</span>
            <h2 id={titleId}>Admin workbench</h2>
          </div>
          <nav className="admin-tabs" role="tablist" aria-label="Admin workspace sections">
            {TABS.map((tab, index) => (
              <button
                key={tab.id}
                ref={(element) => { tabRefs.current[index] = element }}
                type="button"
                role="tab"
                id={`${titleId}-${tab.id}-tab`}
                aria-controls={`${titleId}-${tab.id}-panel`}
                aria-selected={activeTab === tab.id}
                tabIndex={activeTab === tab.id ? 0 : -1}
                onKeyDown={(event) => moveTab(event, index)}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <button type="button" className="admin-close" aria-label="Close admin workspace" onClick={requestClose}>X</button>
        </header>
        <div className="admin-content">
          <TabPanel active={activeTab === 'stats'} id={`${titleId}-stats-panel`} labelledBy={`${titleId}-stats-tab`}><StatsView stats={stats} loading={statsLoading} error={statsError} onRetry={() => {
            setStatsLoading(true)
            setStatsError(null)
            void loadStats()
          }} /></TabPanel>
          <TabPanel active={activeTab === 'matches'} id={`${titleId}-matches-panel`} labelledBy={`${titleId}-matches-tab`}><MatchesView client={client} handleError={handleError} /></TabPanel>
          <TabPanel active={activeTab === 'accounts'} id={`${titleId}-accounts-panel`} labelledBy={`${titleId}-accounts-tab`}><AccountsView client={client} handleError={handleError} /></TabPanel>
          <TabPanel active={activeTab === 'console'} id={`${titleId}-console-panel`} labelledBy={`${titleId}-console-tab`}><ConsoleView client={client} handleError={handleError} /></TabPanel>
        </div>
      </div>
    </dialog>
  )
}
