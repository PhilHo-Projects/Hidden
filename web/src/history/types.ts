export type MatchHistoryOutcome = 'win' | 'loss' | 'tie'

export interface MatchHistoryStats {
  played: number
  wins: number
  losses: number
  ties: number
}

export interface MatchHistorySummary {
  matchId: string
  completedAt: string
  opponentName: string
  outcome: MatchHistoryOutcome
  playerScore: number
  opponentScore: number
  bookmarked: boolean
}

export interface MatchHistoryPage {
  stats: MatchHistoryStats
  matches: MatchHistorySummary[]
  nextCursor: string | null
}

export interface MatchHistoryCell {
  locationId: number
  symbol: string | null
}

export interface MatchHistoryBoard {
  columns: number
  cells: MatchHistoryCell[]
}

export interface MatchHistoryParticipant {
  seat: 0 | 1
  username: string
}

export interface MatchHistoryDetail {
  matchId: string
  completedAt: string
  engine: { id: string; revision: number }
  config: unknown
  turnCount: number
  participants: [MatchHistoryParticipant, MatchHistoryParticipant]
  result: { scores: [number, number]; winner: 0 | 1 | null }
  boards: [MatchHistoryBoard, MatchHistoryBoard]
  viewerSeat: 0 | 1
  bookmarked: boolean
}
