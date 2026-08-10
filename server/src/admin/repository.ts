import type { Seat } from '@hidden/game-core'
import type { MatchHistoryBoard } from '../matchHistory/types'

export interface AdminRuntimeStats {
  readonly connections: number
  readonly onlinePlayers: number
  readonly namedPlayers: number
  readonly authenticatedPlayers: number
  readonly guestPlayers: number
  readonly queuedPlayers: number
  readonly pendingLobbies: number
  readonly activeMatches: number
}

export interface AdminStorageStats {
  readonly accounts: number
  readonly activeSessions: number
  readonly matches: number
}

export interface AdminRuntimeStatsProvider {
  getRuntimeStats(): AdminRuntimeStats
}

export interface AdminMatchCursor {
  readonly completedAt: string
  readonly matchId: string
}

export interface AdminAccountCursor {
  readonly createdAt: string
  readonly accountId: string
}

export interface AdminMatchParticipant {
  readonly seat: Seat
  readonly accountId: string | null
  readonly username: string
}

export interface AdminMatchSummary {
  readonly matchId: string
  readonly completedAtMs: number
  readonly engine: { readonly id: string; readonly revision: number }
  readonly turnCount: number
  readonly participants: readonly [
    AdminMatchParticipant,
    AdminMatchParticipant,
  ]
  readonly result: {
    readonly scores: readonly [number, number]
    readonly winner: Seat | null
  }
  readonly bookmarkCount: number
}

export interface AdminMatchDetail extends AdminMatchSummary {
  readonly schemaVersion: number
  readonly config: unknown
  readonly boards: readonly [MatchHistoryBoard, MatchHistoryBoard]
}

export interface AdminAccountSummary {
  readonly id: string
  readonly username: string
  readonly role: 'player' | 'admin'
  readonly createdAtMs: number
  readonly lastSeenAtMs: number | null
  readonly activeSessionCount: number
  readonly matchCount: number
}

export interface AdminMatchPage {
  readonly items: readonly AdminMatchSummary[]
  readonly nextCursor: AdminMatchCursor | null
}

export interface AdminAccountPage {
  readonly items: readonly AdminAccountSummary[]
  readonly nextCursor: AdminAccountCursor | null
}

export interface ListAdminMatchesOptions {
  readonly limit: number
  readonly cursor?: AdminMatchCursor
  readonly query?: string
}

export interface ListAdminAccountsOptions {
  readonly limit: number
  readonly cursor?: AdminAccountCursor
  readonly query?: string
}

export interface AdminRepository {
  getStorageStats(now: Date): Promise<AdminStorageStats>
  listMatches(options: ListAdminMatchesOptions): Promise<AdminMatchPage>
  getMatch(matchId: string): Promise<AdminMatchDetail | undefined>
  listAccounts(options: ListAdminAccountsOptions): Promise<AdminAccountPage>
}
