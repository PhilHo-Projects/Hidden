import {
  clampGameConfig,
  DEFAULT_GAME_CONFIG,
  type GameConfig,
} from '@hidden/game-core'
import type { MatchConfig } from './types'
import type { Screen } from './viewModel'

export type OnlineTerminalScreen = 'disconnected' | 'sync-lost'

export const MATCH_COUNTDOWN_STEPS = Object.freeze([
  Object.freeze({ label: '3', durationMs: 700 }),
  Object.freeze({ label: '2', durationMs: 700 }),
  Object.freeze({ label: '1', durationMs: 700 }),
  Object.freeze({ label: 'GO!', durationMs: 520 }),
])

export const MATCH_COUNTDOWN_DURATION_MS = MATCH_COUNTDOWN_STEPS.reduce(
  (total, step) => total + step.durationMs,
  0,
)

export function isOnlineTerminalScreen(
  screen: Screen,
): screen is OnlineTerminalScreen {
  return screen === 'disconnected' || screen === 'sync-lost'
}

export function markOnlineTerminalScreen(
  screenRef: { current: Screen },
  screen: OnlineTerminalScreen,
) {
  screenRef.current = screen
}

export function tryMarkOnlineTerminalScreen(
  screenRef: { current: Screen },
  screen: OnlineTerminalScreen,
) {
  if (isOnlineTerminalScreen(screenRef.current)) return false
  markOnlineTerminalScreen(screenRef, screen)
  return true
}

// The server still sends only the three legacy rules. Knobs it does not yet
// carry fall back to the default game, so an online match plays exactly as it
// did before. Replaced by a straight config spread once the server migrates.
// Spreads the whole server config. Cherry-picking fields here silently
// defaulted the rest, so the UI believed power-ups were on in a match whose
// engine had them off.
export function createOnlineMatchConfig(config: GameConfig): MatchConfig {
  return { ...clampGameConfig(config), isOnline: true, hasAI: false }
}

export interface OnlineMatchEventState {
  config: GameConfig | null
}

type OnlineMatchEvent =
  | { type: 'match-found'; config: GameConfig }
  | { type: 'game-start'; isMyTurn: boolean }

export type OnlineMatchEventTransition =
  | { type: 'match-found'; state: OnlineMatchEventState }
  | {
      type: 'game-start'
      state: OnlineMatchEventState
      config: MatchConfig
      isMyTurn: boolean
    }

export function transitionOnlineMatchEvent(
  state: OnlineMatchEventState,
  event: OnlineMatchEvent,
): OnlineMatchEventTransition {
  if (event.type === 'match-found') {
    return {
      type: event.type,
      state: { config: event.config },
    }
  }

  return {
    type: event.type,
    state,
    config: createOnlineMatchConfig(state.config ?? DEFAULT_GAME_CONFIG),
    isMyTurn: event.isMyTurn,
  }
}

interface RestartMatchOptions {
  config: MatchConfig
  sendReady: (ready: boolean) => void
  showReady: () => void
  beginLocalMatch: (config: MatchConfig) => void
}

export function restartMatch(options: RestartMatchOptions) {
  if (options.config.isOnline) {
    options.sendReady(true)
    options.showReady()
    return
  }

  options.beginLocalMatch(options.config)
}

export function shouldResolveTimeoutLocally(config: MatchConfig) {
  return !config.isOnline
}
