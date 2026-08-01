import type { MatchRules } from './matchRules'
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

export function beginOnlineMatch(
  rules: MatchRules,
  isMyTurn: boolean,
  beginCountdown: (config: MatchConfig, isMyTurn: boolean) => void,
) {
  beginCountdown(createOnlineMatchConfig(rules), isMyTurn)
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
