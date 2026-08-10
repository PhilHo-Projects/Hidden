import type { AdminStats } from './types'

export interface AdminConsoleResult {
  action: 'append' | 'clear'
  lines: string[]
  stats?: AdminStats
}

export async function runAdminConsoleCommand(
  input: string,
  getStats: () => Promise<AdminStats>,
): Promise<AdminConsoleResult> {
  const command = input.trim().toLowerCase()
  if (command === 'help') {
    return {
      action: 'append',
      lines: [
        'Available commands: help, status, clear',
        'Commands are allowlisted. Shell, SQL, and arbitrary code are disabled.',
      ],
    }
  }
  if (command === 'clear') return { action: 'clear', lines: [] }
  if (command === 'status') {
    const stats = await getStats()
    return {
      action: 'append',
      stats,
      lines: [
        `Online players: ${stats.runtime.onlinePlayers} (${stats.runtime.namedPlayers} named; ${stats.runtime.authenticatedPlayers} accounts, ${stats.runtime.guestPlayers} guests)`,
        `Queue: ${stats.runtime.queuedPlayers} · Pending lobbies: ${stats.runtime.pendingLobbies} · Active matches: ${stats.runtime.activeMatches}`,
        `Stored: ${stats.storage.accounts} accounts · ${stats.storage.activeSessions} active sessions · ${stats.storage.matches} matches`,
      ],
    }
  }
  return {
    action: 'append',
    lines: ['Unknown command. Type help to list safe commands.'],
  }
}
