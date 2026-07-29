import type { CellState, GameState } from './types'
import type { UserEntry } from './protocol'

export type Screen =
  | 'intro'
  | 'account'
  | 'mode-select'
  | 'online-menu'
  | 'offline-setup'
  | 'matchmaking'
  | 'ready'
  | 'countdown'
  | 'battle'
  | 'results'
  | 'disconnected'

export function getScreenLabel(screen: Screen) {
  return {
    intro: 'Hidden',
    account: 'Account',
    'mode-select': 'Play',
    'online-menu': 'Online',
    'offline-setup': 'Offline',
    matchmaking: 'Searching',
    ready: 'Ready',
    countdown: 'Launch',
    battle: 'Battle',
    results: 'Results',
    disconnected: 'Disconnected',
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
    'offline-setup': 'mode-select',
    matchmaking: 'online-menu',
    ready: 'online-menu',
    countdown: matchSetup,
    battle: matchSetup,
    results: matchSetup,
    disconnected: 'online-menu',
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
