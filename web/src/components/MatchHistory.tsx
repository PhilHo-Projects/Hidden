import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { COLOR_BY_SYMBOL } from '../game/constants'
import {
  MatchHistoryApiError,
  type MatchHistoryClient,
} from '../history/historyClient'
import {
  historyReducer,
  initialHistoryState,
  type HistoryFilter,
  type HistoryState,
} from '../history/historyState'
import type {
  MatchHistoryBoard,
  MatchHistorySummary,
} from '../history/types'

interface MatchHistoryScreenProps {
  client: MatchHistoryClient
  onSignIn: () => void
}

interface MatchHistoryViewProps {
  state: HistoryState
  onSelectFilter: (filter: HistoryFilter) => void
  onRetryList: () => void
  onLoadMore: () => void
  onOpenDetail: (matchId: string) => void
  onCloseDetail: () => void
  onRetryDetail: () => void
  onBookmark: (matchId: string, bookmarked: boolean) => void
  onSignIn: () => void
}

function isExpired(error: unknown) {
  return (
    error instanceof MatchHistoryApiError && error.code === 'account_required'
  )
}

function formatCompletedAt(completedAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(completedAt))
}

function HistoryRecovery({
  expired,
  detail = false,
  onRetry,
  onSignIn,
}: {
  expired: boolean
  detail?: boolean
  onRetry: () => void
  onSignIn: () => void
}) {
  return (
    <section className="history-recovery" role="status">
      <p>{expired ? 'ACCOUNT REQUIRED' : 'TEMPORARY ERROR'}</p>
      <h2>
        {expired
          ? 'Your session expired'
          : detail
            ? 'This match could not be loaded'
            : 'History could not be loaded'}
      </h2>
      <span>
        {expired
          ? 'Sign in again to return to your private match record.'
          : 'Your matches are still safe. The history service did not answer.'}
      </span>
      <button
        type="button"
        className="history-action-button"
        onClick={expired ? onSignIn : onRetry}
      >
        {expired ? 'Sign in again' : 'Try again'}
      </button>
    </section>
  )
}

function HistorySkeleton({ detail = false }: { detail?: boolean }) {
  return (
    <div className="history-skeleton" aria-busy="true" aria-label="Loading match history">
      <span className="history-skeleton-line" />
      {Array.from({ length: detail ? 2 : 4 }, (_, index) => (
        <span className="history-skeleton-row" key={index} />
      ))}
    </div>
  )
}

function BookmarkButton({
  match,
  pending,
  onBookmark,
}: {
  match: Pick<MatchHistorySummary, 'matchId' | 'opponentName' | 'bookmarked'>
  pending: boolean
  onBookmark: (matchId: string, bookmarked: boolean) => void
}) {
  const action = match.bookmarked ? 'Remove' : 'Bookmark'
  return (
    <button
      type="button"
      className={`history-bookmark-button ${match.bookmarked ? 'history-bookmark-active' : ''}`}
      aria-label={`${action} match against ${match.opponentName}${
        match.bookmarked ? ' from Interesting' : ' as Interesting'
      }`}
      aria-pressed={match.bookmarked}
      disabled={pending}
      onClick={() => onBookmark(match.matchId, !match.bookmarked)}
    >
      <span aria-hidden="true">{match.bookmarked ? '★' : '☆'}</span>
    </button>
  )
}

function HistoryRow({
  match,
  pending,
  bookmarkError,
  onOpenDetail,
  onBookmark,
}: {
  match: MatchHistorySummary
  pending: boolean
  bookmarkError: boolean
  onOpenDetail: (matchId: string) => void
  onBookmark: (matchId: string, bookmarked: boolean) => void
}) {
  return (
    <li className="history-row">
      <button
        type="button"
        className="history-row-main"
        aria-label={`View match against ${match.opponentName}`}
        onClick={() => onOpenDetail(match.matchId)}
      >
        <span className={`history-outcome history-outcome-${match.outcome}`}>
          {match.outcome}
        </span>
        <span className="history-opponent">
          <small>Opponent</small>
          <strong>{match.opponentName}</strong>
        </span>
        <strong className="history-score">
          {match.playerScore}–{match.opponentScore}
        </strong>
        <time dateTime={match.completedAt}>
          {formatCompletedAt(match.completedAt)}
        </time>
        <span className="history-row-arrow" aria-hidden="true">→</span>
      </button>
      <BookmarkButton
        match={match}
        pending={pending}
        onBookmark={onBookmark}
      />
      {bookmarkError ? (
        <small className="history-bookmark-error" role="alert">
          Bookmark was not saved. Try again.
        </small>
      ) : null}
    </li>
  )
}

function HistoryBoardView({
  board,
  name,
  score,
  winner,
  viewer,
}: {
  board: MatchHistoryBoard
  name: string
  score: number
  winner: boolean
  viewer: boolean
}) {
  return (
    <section className="history-board">
      <header>
        <div>
          <p>{viewer ? 'You' : winner ? 'Winner' : 'Opponent'}</p>
          <h3>{name}</h3>
        </div>
        <strong>{score}</strong>
      </header>
      <div
        className="history-board-grid"
        style={{ '--history-board-columns': board.columns } as CSSProperties}
      >
        {board.cells.map((cell) => {
          const knownSymbol =
            cell.symbol === 'rock' ||
            cell.symbol === 'paper' ||
            cell.symbol === 'scissors'
              ? cell.symbol
              : null
          const label = cell.symbol ?? 'empty'
          return (
            <div
              className={`history-cell ${knownSymbol ? 'history-cell-known' : ''}`}
              aria-label={`Cell ${cell.locationId + 1}, ${label}`}
              key={cell.locationId}
            >
              {knownSymbol ? (
                <span
                  className="history-cell-ink"
                  style={{ backgroundColor: COLOR_BY_SYMBOL[knownSymbol] }}
                  aria-hidden="true"
                />
              ) : cell.symbol ? (
                <span className="history-cell-fallback">{cell.symbol}</span>
              ) : (
                <span className="history-cell-empty" aria-hidden="true" />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function MatchDetail({
  state,
  onCloseDetail,
  onRetryDetail,
  onBookmark,
  onSignIn,
}: Pick<
  MatchHistoryViewProps,
  | 'state'
  | 'onCloseDetail'
  | 'onRetryDetail'
  | 'onBookmark'
  | 'onSignIn'
>) {
  const detail = state.detail

  return (
    <div className="history-detail">
      <button
        type="button"
        className="history-detail-back"
        onClick={onCloseDetail}
      >
        <span aria-hidden="true">←</span> All matches
      </button>

      {state.detailStatus === 'loading' ? <HistorySkeleton detail /> : null}
      {state.detailStatus === 'expired' ? (
        <HistoryRecovery
          expired
          detail
          onRetry={onRetryDetail}
          onSignIn={onSignIn}
        />
      ) : null}
      {state.detailStatus === 'error' ? (
        <HistoryRecovery
          expired={false}
          detail
          onRetry={onRetryDetail}
          onSignIn={onSignIn}
        />
      ) : null}

      {state.detailStatus === 'ready' && detail ? (
        <>
          <header className="history-detail-heading">
            <div>
              <p>Completed online match</p>
              <h2>{detail.participants[0].username} vs {detail.participants[1].username}</h2>
              <time dateTime={detail.completedAt}>
                {formatCompletedAt(detail.completedAt)}
              </time>
            </div>
            <button
              type="button"
              className={`history-detail-bookmark ${detail.bookmarked ? 'history-bookmark-active' : ''}`}
              aria-pressed={detail.bookmarked}
              disabled={state.pendingBookmarks.includes(detail.matchId)}
              onClick={() => onBookmark(detail.matchId, !detail.bookmarked)}
            >
              <span aria-hidden="true">{detail.bookmarked ? '★' : '☆'}</span>
              {detail.bookmarked
                ? 'Remove Interesting bookmark'
                : 'Mark as Interesting'}
            </button>
          </header>

          {state.bookmarkErrors.includes(detail.matchId) ? (
            <p className="history-bookmark-error" role="alert">
              Bookmark was not saved. Try again.
            </p>
          ) : null}

          <div className="history-detail-score" aria-label="Final score">
            <span>{detail.participants[0].username}</span>
            <strong>{detail.result.scores[0]}–{detail.result.scores[1]}</strong>
            <span>{detail.participants[1].username}</span>
          </div>

          <section className="history-final-boards" aria-labelledby="history-final-boards-title">
            <h2 id="history-final-boards-title">Final boards</h2>
            <div className="history-board-pair">
              {([0, 1] as const).map((seat) => (
                <HistoryBoardView
                  key={seat}
                  board={detail.boards[seat]}
                  name={detail.participants[seat].username}
                  score={detail.result.scores[seat]}
                  winner={detail.result.winner === seat}
                  viewer={detail.viewerSeat === seat}
                />
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

export function MatchHistoryView({
  state,
  onSelectFilter,
  onRetryList,
  onLoadMore,
  onOpenDetail,
  onCloseDetail,
  onRetryDetail,
  onBookmark,
  onSignIn,
}: MatchHistoryViewProps) {
  return (
    <section className="history-screen" aria-labelledby="history-title">
      <div className="history-ledger">
        <header className="history-heading">
          <p>Your permanent record</p>
          <h1 id="history-title">Match History</h1>
          <span>Completed online matches. Final boards only—for now.</span>
        </header>

        {state.selectedMatchId ? (
          <MatchDetail
            state={state}
            onCloseDetail={onCloseDetail}
            onRetryDetail={onRetryDetail}
            onBookmark={onBookmark}
            onSignIn={onSignIn}
          />
        ) : (
          <>
            <dl className="history-stats" aria-label="Match totals">
              {(
                [
                  ['Played', state.stats.played],
                  ['Wins', state.stats.wins],
                  ['Losses', state.stats.losses],
                  ['Ties', state.stats.ties],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>

            <div className="history-toolbar">
              <div className="history-filters" aria-label="History filter">
                <button
                  type="button"
                  aria-pressed={state.filter === 'all'}
                  onClick={() => onSelectFilter('all')}
                >
                  All matches
                </button>
                <button
                  type="button"
                  aria-pressed={state.filter === 'interesting'}
                  onClick={() => onSelectFilter('interesting')}
                >
                  Interesting
                </button>
              </div>
              <small>Newest first</small>
            </div>

            {state.listStatus === 'loading' ? <HistorySkeleton /> : null}
            {state.listStatus === 'expired' ? (
              <HistoryRecovery
                expired
                onRetry={onRetryList}
                onSignIn={onSignIn}
              />
            ) : null}
            {state.listStatus === 'error' ? (
              <HistoryRecovery
                expired={false}
                onRetry={onRetryList}
                onSignIn={onSignIn}
              />
            ) : null}

            {state.listStatus === 'ready' && state.matches.length === 0 ? (
              <section className="history-empty">
                <p>{state.filter === 'all' ? 'NO RECORDS' : 'NO BOOKMARKS'}</p>
                <h2>
                  {state.filter === 'all'
                    ? 'No completed online matches yet'
                    : 'Nothing marked Interesting yet'}
                </h2>
                <span>
                  {state.filter === 'all'
                    ? 'Finish an online match and its result will appear here.'
                    : 'Use the star beside a match to keep notable examples together.'}
                </span>
              </section>
            ) : null}

            {state.listStatus === 'ready' && state.matches.length > 0 ? (
              <>
                <ol className="history-list">
                  {state.matches.map((match) => (
                    <HistoryRow
                      key={match.matchId}
                      match={match}
                      pending={state.pendingBookmarks.includes(match.matchId)}
                      bookmarkError={state.bookmarkErrors.includes(match.matchId)}
                      onOpenDetail={onOpenDetail}
                      onBookmark={onBookmark}
                    />
                  ))}
                </ol>
                {state.moreError ? (
                  <p className="history-more-error" role="alert">
                    More matches could not be loaded. Try again.
                  </p>
                ) : null}
                {state.nextCursor ? (
                  <button
                    type="button"
                    className="history-load-more"
                    disabled={state.loadingMore}
                    onClick={onLoadMore}
                  >
                    {state.loadingMore ? 'Loading…' : state.moreError ? 'Try again' : 'Load more'}
                  </button>
                ) : null}
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  )
}

export function MatchHistoryScreen({
  client,
  onSignIn,
}: MatchHistoryScreenProps) {
  const [state, dispatch] = useReducer(historyReducer, initialHistoryState)
  const [listAttempt, setListAttempt] = useState(0)
  const listRequest = useRef(0)
  const detailRequest = useRef(0)

  useEffect(() => {
    const request = ++listRequest.current
    let active = true

    void client
      .list({ bookmarkedOnly: state.filter === 'interesting' })
      .then((page) => {
        if (active && request === listRequest.current) {
          dispatch({ type: 'list-loaded', page, append: false })
        }
      })
      .catch((error: unknown) => {
        if (active && request === listRequest.current) {
          dispatch({ type: 'list-failed', expired: isExpired(error) })
        }
      })

    return () => {
      active = false
    }
  }, [client, listAttempt, state.filter])

  const selectFilter = (filter: HistoryFilter) => {
    if (filter === state.filter) return
    listRequest.current += 1
    detailRequest.current += 1
    dispatch({ type: 'filter-selected', filter })
  }

  const retryList = () => {
    dispatch({ type: 'list-started' })
    setListAttempt((attempt) => attempt + 1)
  }

  const loadMore = async () => {
    if (!state.nextCursor || state.loadingMore) return
    const request = ++listRequest.current
    const filter = state.filter
    dispatch({ type: 'more-started' })
    try {
      const page = await client.list({
        bookmarkedOnly: filter === 'interesting',
        cursor: state.nextCursor,
      })
      if (request === listRequest.current) {
        dispatch({ type: 'list-loaded', page, append: true })
      }
    } catch (error) {
      if (request !== listRequest.current) return
      if (isExpired(error)) {
        dispatch({ type: 'list-failed', expired: true })
      } else {
        dispatch({ type: 'more-failed' })
      }
    }
  }

  const loadDetail = async (matchId: string) => {
    const request = ++detailRequest.current
    dispatch({ type: 'detail-opened', matchId })
    try {
      const detail = await client.get(matchId)
      if (request === detailRequest.current) {
        dispatch({ type: 'detail-loaded', detail })
      }
    } catch (error) {
      if (request === detailRequest.current) {
        dispatch({ type: 'detail-failed', expired: isExpired(error) })
      }
    }
  }

  const closeDetail = () => {
    detailRequest.current += 1
    dispatch({ type: 'detail-closed' })
  }

  const saveBookmark = async (matchId: string, bookmarked: boolean) => {
    if (state.pendingBookmarks.includes(matchId)) return
    dispatch({ type: 'bookmark-started', matchId, bookmarked })
    try {
      const saved = await client.setBookmarked(matchId, bookmarked)
      dispatch({ type: 'bookmark-saved', matchId, bookmarked: saved })
    } catch (error) {
      dispatch({ type: 'bookmark-failed', matchId, bookmarked: !bookmarked })
      if (isExpired(error)) {
        dispatch({ type: 'session-expired' })
      }
    }
  }

  return (
    <MatchHistoryView
      state={state}
      onSelectFilter={selectFilter}
      onRetryList={retryList}
      onLoadMore={() => void loadMore()}
      onOpenDetail={(matchId) => void loadDetail(matchId)}
      onCloseDetail={closeDetail}
      onRetryDetail={() => {
        if (state.selectedMatchId) void loadDetail(state.selectedMatchId)
      }}
      onBookmark={(matchId, bookmarked) =>
        void saveBookmark(matchId, bookmarked)
      }
      onSignIn={onSignIn}
    />
  )
}
