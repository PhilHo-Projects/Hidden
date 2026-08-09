import type {
  EngineRef,
  GameConfig,
  GameResult,
  GameState,
  Seat,
} from '@hidden/game-core'

export interface MatchHistoryParticipant {
  readonly seat: Seat
  readonly accountId?: string
  readonly username: string
}

export interface MatchHistoryCell {
  readonly locationId: number
  readonly symbol: string | null
}

export interface MatchHistoryBoard {
  readonly columns: number
  readonly cells: readonly MatchHistoryCell[]
}

export interface MatchHistoryRecordV1 {
  readonly schemaVersion: 1
  readonly matchId: string
  readonly completedAtMs: number
  readonly engine: EngineRef
  readonly config: GameConfig
  readonly turnCount: number
  readonly participants: readonly [
    MatchHistoryParticipant,
    MatchHistoryParticipant,
  ]
  readonly result: GameResult
  readonly boards: readonly [MatchHistoryBoard, MatchHistoryBoard]
}

interface CreateMatchHistoryRecordInput {
  readonly matchId: string
  readonly completedAtMs: number
  readonly participants: readonly [
    MatchHistoryParticipantInput,
    MatchHistoryParticipantInput,
  ]
  readonly state: GameState
}

interface MatchHistoryParticipantInput {
  readonly seat: Seat
  readonly accountId?: string | undefined
  readonly username: string
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
  }
  return value
}

export function createMatchHistoryRecord(
  input: CreateMatchHistoryRecordInput,
): MatchHistoryRecordV1 {
  if (!input.state.result || input.state.phase !== 'finished') {
    throw new Error('A match history record requires a finished game state.')
  }

  const participantSnapshot = (participant: MatchHistoryParticipantInput) => ({
    seat: participant.seat,
    ...(participant.accountId ? { accountId: participant.accountId } : {}),
    username: participant.username,
  })
  const boardSnapshot = (seat: Seat): MatchHistoryBoard => ({
    columns: input.state.config.boardSize,
    cells: input.state.boards[seat].locations.map((location) => ({
      locationId: location.locationId,
      symbol: location.symbol,
    })),
  })

  return deepFreeze({
    schemaVersion: 1,
    matchId: input.matchId,
    completedAtMs: input.completedAtMs,
    engine: { ...input.state.spec.engine },
    config: {
      ...input.state.config,
      powerups: { ...input.state.config.powerups },
      powerupBySymbol: { ...input.state.config.powerupBySymbol },
    },
    turnCount: input.state.turnCount,
    participants: [
      participantSnapshot(input.participants[0]),
      participantSnapshot(input.participants[1]),
    ],
    result: {
      scores: [...input.state.result.scores] as [number, number],
      winner: input.state.result.winner,
    },
    boards: [boardSnapshot(0), boardSnapshot(1)],
  })
}
