import {
  DEFAULT_MATCH_RULES,
  type MatchRules,
} from './matchRules'
import type { MatchConfig } from './types'

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
