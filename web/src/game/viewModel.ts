import type { CellState, GameState } from './types'
import type { UserEntry } from './protocol'

export type Screen =
  | 'intro'
  | 'account'
  | 'mode-select'
  | 'online-menu'
  | 'lobby-create'
  | 'lobby-find'
  | 'offline-setup'
  | 'matchmaking'
  | 'ready'
  | 'countdown'
  | 'battle'
  | 'results'
  | 'disconnected'
  | 'sync-lost'

export function getScreenLabel(screen: Screen) {
  return {
    intro: 'Hidden',
    account: 'Account',
    'mode-select': 'Play',
    'online-menu': 'Online',
    'lobby-create': 'Create Game',
    'lobby-find': 'Find Game',
    'offline-setup': 'Offline',
    matchmaking: 'Searching',
    ready: 'Ready',
    countdown: 'Launch',
    battle: 'Battle',
    results: 'Results',
    disconnected: 'Disconnected',
    'sync-lost': 'Sync Lost',
  }[screen]
}

export function createGuestName(random: () => number = Math.random) {
  const suffix = Math.min(9999, Math.floor(random() * 10_000))
  return `Guest#${suffix.toString().padStart(4, '0')}`
}

export function resolvePlayerName(accountUsername: string | undefined, guestUsername: string) {
  return accountUsername ?? guestUsername
}

export function getScoreCountLabels(cells: CellState[]) {
  let count = 0

  return cells.reduce<Record<number, number>>((labels, cell, index) => {
    if (cell.occupied) {
      labels[index] = ++count
    }
    return labels
  }, {})
}

export function getBackTarget(screen: Screen, isOnlineMatch = false): Screen {
  const matchSetup: Screen = isOnlineMatch ? 'online-menu' : 'offline-setup'
  const targets: Record<Screen, Screen> = {
    intro: 'intro',
    account: 'intro',
    'mode-select': 'intro',
    'online-menu': 'mode-select',
    'lobby-create': 'online-menu',
    'lobby-find': 'online-menu',
    'offline-setup': 'mode-select',
    matchmaking: 'online-menu',
    ready: 'online-menu',
    countdown: matchSetup,
    battle: matchSetup,
    results: matchSetup,
    disconnected: 'online-menu',
    'sync-lost': 'online-menu',
  }

  return targets[screen]
}

export function getOpponentName(users: UserEntry[], clientId: number | null | undefined, match: GameState | null) {
  return (
    users.find((entry) => entry.userId !== clientId)?.userName ??
    (match?.config.hasAI ? 'Practice Bot' : 'Opponent')
  )
}

export function shouldShowOpponentBoard(match: GameState | null, screen: Screen) {
  if (!match) return false
  return !match.config.blindMode || match.playerPowerups.revealActive || screen === 'results'
}

/**
 * The turn line under the round callout. The opponent is named by role rather
 * than by name: the line is read at a glance mid-match, a long name wrapped it,
 * and the name is already on the top bar and on their own board.
 */
export function getTurnStatusText(match: GameState) {
  if (!match.isMyTurn) return 'Waiting for opponent'
  return match.shieldSelectionMode ? 'Choose a tile to shield.' : 'Your Turn'
}

/**
 * Whether the move tiles should call for attention. True only while the player
 * owes a move and has not loaded one; shield selection wants the board looked
 * at instead, so it suppresses the prompt.
 */
export function shouldPromptMoveChoice(match: GameState | null, screen: Screen) {
  if (!match || screen !== 'battle') return false
  return (
    match.phase === 'battle' &&
    match.isMyTurn &&
    !match.shieldSelectionMode &&
    !match.selectedColor
  )
}
