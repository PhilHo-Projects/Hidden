import {
  DEFAULT_MATCH_RULES,
  type MatchRules,
} from './matchRules'
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

export function createOnlineMatchConfig(rules: MatchRules): MatchConfig {
  return {
    rounds: rules.rounds,
    turnSeconds: rules.turnSeconds,
    blindMode: rules.blindMode,
    isOnline: true,
    hasAI: false,
  }
}

export interface OnlineMatchEventState {
  rules: MatchRules | null
}

type OnlineMatchEvent =
  | { type: 'match-found'; rules: MatchRules }
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
      state: { rules: event.rules },
    }
  }

  return {
    type: event.type,
    state,
    config: createOnlineMatchConfig(state.rules ?? DEFAULT_MATCH_RULES),
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
