export interface MatchRules {
  rounds: number
  turnSeconds: number
  blindMode: boolean
}

export const DEFAULT_MATCH_RULES: Readonly<MatchRules> = Object.freeze({
  rounds: 6,
  turnSeconds: 10,
  blindMode: true,
})

export function decodeMatchRules(value: unknown): MatchRules | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const candidate = value as Record<string, unknown>
  if (
    typeof candidate.rounds !== 'number' ||
    !Number.isFinite(candidate.rounds) ||
    typeof candidate.turnSeconds !== 'number' ||
    !Number.isFinite(candidate.turnSeconds) ||
    typeof candidate.blindMode !== 'boolean'
  ) {
    return undefined
  }

  return {
    rounds: candidate.rounds,
    turnSeconds: candidate.turnSeconds,
    blindMode: candidate.blindMode,
  }
}

export function clampMatchRules(
  value: Partial<Record<keyof MatchRules, unknown>> | null | undefined,
): MatchRules {
  const rounds = finiteNumberOrDefault(value?.rounds, DEFAULT_MATCH_RULES.rounds)
  const turnSeconds = finiteNumberOrDefault(
    value?.turnSeconds,
    DEFAULT_MATCH_RULES.turnSeconds,
  )

  return {
    rounds: Math.min(20, Math.max(1, Math.trunc(rounds))),
    turnSeconds: Math.min(60, Math.max(2, Math.trunc(turnSeconds))),
    blindMode:
      typeof value?.blindMode === 'boolean'
        ? value.blindMode
        : DEFAULT_MATCH_RULES.blindMode,
  }
}

function finiteNumberOrDefault(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
