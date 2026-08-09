import type {
  MatchHistoryDetail,
  MatchHistoryPage,
  MatchHistoryStats,
  MatchHistorySummary,
} from './types'

export type HistoryFilter = 'all' | 'interesting'
export type HistoryListStatus = 'loading' | 'ready' | 'expired' | 'error'
export type HistoryDetailStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'expired'
  | 'error'

export interface HistoryState {
  filter: HistoryFilter
  listStatus: HistoryListStatus
  stats: MatchHistoryStats
  matches: MatchHistorySummary[]
  nextCursor: string | null
  loadingMore: boolean
  moreError: boolean
  selectedMatchId: string | null
  detailStatus: HistoryDetailStatus
  detail: MatchHistoryDetail | null
  pendingBookmarks: string[]
  bookmarkErrors: string[]
}

export const initialHistoryState: HistoryState = {
  filter: 'all',
  listStatus: 'loading',
  stats: { played: 0, wins: 0, losses: 0, ties: 0 },
  matches: [],
  nextCursor: null,
  loadingMore: false,
  moreError: false,
  selectedMatchId: null,
  detailStatus: 'idle',
  detail: null,
  pendingBookmarks: [],
  bookmarkErrors: [],
}

export type HistoryAction =
  | { type: 'filter-selected'; filter: HistoryFilter }
  | { type: 'list-started' }
  | { type: 'list-loaded'; page: MatchHistoryPage; append: boolean }
  | { type: 'list-failed'; expired: boolean }
  | { type: 'more-started' }
  | { type: 'more-failed' }
  | { type: 'detail-opened'; matchId: string }
  | { type: 'detail-loaded'; detail: MatchHistoryDetail }
  | { type: 'detail-failed'; expired: boolean }
  | { type: 'detail-closed' }
  | { type: 'bookmark-started'; matchId: string; bookmarked: boolean }
  | { type: 'bookmark-saved'; matchId: string; bookmarked: boolean }
  | { type: 'bookmark-failed'; matchId: string; bookmarked: boolean }
  | { type: 'session-expired' }

function setBookmark(
  state: HistoryState,
  matchId: string,
  bookmarked: boolean,
) {
  return {
    matches: state.matches.map((match) =>
      match.matchId === matchId ? { ...match, bookmarked } : match,
    ),
    detail:
      state.detail?.matchId === matchId
        ? { ...state.detail, bookmarked }
        : state.detail,
  }
}

function without(items: string[], matchId: string) {
  return items.filter((item) => item !== matchId)
}

export function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case 'filter-selected':
      return {
        ...state,
        filter: action.filter,
        listStatus: 'loading',
        matches: [],
        nextCursor: null,
        loadingMore: false,
        moreError: false,
        selectedMatchId: null,
        detailStatus: 'idle',
        detail: null,
        bookmarkErrors: [],
      }
    case 'list-started':
      return {
        ...state,
        listStatus: 'loading',
        matches: [],
        nextCursor: null,
        loadingMore: false,
        moreError: false,
      }
    case 'list-loaded':
      return {
        ...state,
        listStatus: 'ready',
        stats: action.page.stats,
        matches: action.append
          ? [...state.matches, ...action.page.matches]
          : action.page.matches,
        nextCursor: action.page.nextCursor,
        loadingMore: false,
        moreError: false,
      }
    case 'list-failed':
      return {
        ...state,
        listStatus: action.expired ? 'expired' : 'error',
        loadingMore: false,
      }
    case 'more-started':
      return { ...state, loadingMore: true, moreError: false }
    case 'more-failed':
      return { ...state, loadingMore: false, moreError: true }
    case 'detail-opened':
      return {
        ...state,
        selectedMatchId: action.matchId,
        detailStatus: 'loading',
        detail: null,
      }
    case 'detail-loaded':
      return {
        ...state,
        selectedMatchId: action.detail.matchId,
        detailStatus: 'ready',
        detail: action.detail,
      }
    case 'detail-failed':
      return {
        ...state,
        detailStatus: action.expired ? 'expired' : 'error',
      }
    case 'detail-closed':
      return {
        ...state,
        selectedMatchId: null,
        detailStatus: 'idle',
        detail: null,
      }
    case 'bookmark-started':
      return {
        ...state,
        ...setBookmark(state, action.matchId, action.bookmarked),
        pendingBookmarks: [
          ...without(state.pendingBookmarks, action.matchId),
          action.matchId,
        ],
        bookmarkErrors: without(state.bookmarkErrors, action.matchId),
      }
    case 'bookmark-saved': {
      const updated = setBookmark(state, action.matchId, action.bookmarked)
      return {
        ...state,
        ...updated,
        matches:
          state.filter === 'interesting' && !action.bookmarked
            ? updated.matches.filter((match) => match.matchId !== action.matchId)
            : updated.matches,
        pendingBookmarks: without(state.pendingBookmarks, action.matchId),
      }
    }
    case 'bookmark-failed':
      return {
        ...state,
        ...setBookmark(state, action.matchId, action.bookmarked),
        pendingBookmarks: without(state.pendingBookmarks, action.matchId),
        bookmarkErrors: [
          ...without(state.bookmarkErrors, action.matchId),
          action.matchId,
        ],
      }
    case 'session-expired':
      return {
        ...state,
        listStatus: 'expired',
        detailStatus: state.selectedMatchId ? 'expired' : state.detailStatus,
        loadingMore: false,
      }
  }
}
