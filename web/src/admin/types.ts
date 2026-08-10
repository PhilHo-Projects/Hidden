export interface AdminRuntimeStats {
  connections: number
  onlinePlayers: number
  namedPlayers: number
  authenticatedPlayers: number
  guestPlayers: number
  queuedPlayers: number
  pendingLobbies: number
  activeMatches: number
}

export interface AdminStorageStats {
  accounts: number
  activeSessions: number
  matches: number
}

export interface AdminStats {
  capturedAt: string
  runtime: AdminRuntimeStats
  storage: AdminStorageStats
}

export interface AdminMatchParticipant {
  seat: 0 | 1
  accountId: string | null
  username: string
}

export interface AdminMatchSummary {
  matchId: string
  completedAt: string
  engine: { id: string; revision: number }
  turnCount: number
  participants: [AdminMatchParticipant, AdminMatchParticipant]
  result: { scores: [number, number]; winner: 0 | 1 | null }
  bookmarkCount: number
}

export interface AdminMatchCell {
  locationId: number
  symbol: string | null
}

export interface AdminMatchBoard {
  columns: number
  cells: AdminMatchCell[]
}

export interface AdminMatchDetail extends AdminMatchSummary {
  schemaVersion: number
  config: unknown
  boards: [AdminMatchBoard, AdminMatchBoard]
}

export interface AdminAccountSummary {
  id: string
  username: string
  role: 'player' | 'admin'
  createdAt: string
  lastSeenAt: string | null
  activeSessionCount: number
  matchCount: number
}

export interface AdminCursorPage<T> {
  items: T[]
  nextCursor: string | null
}
