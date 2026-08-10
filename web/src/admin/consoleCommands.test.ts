import { describe, expect, it, vi } from 'vitest'
import type { AdminStats } from './types'
import { runAdminConsoleCommand } from './consoleCommands'

const stats: AdminStats = {
  capturedAt: '2030-01-01T00:00:00.000Z',
  runtime: {
    connections: 5,
    onlinePlayers: 4,
    namedPlayers: 4,
    authenticatedPlayers: 2,
    guestPlayers: 2,
    queuedPlayers: 1,
    pendingLobbies: 1,
    activeMatches: 1,
  },
  storage: { accounts: 8, activeSessions: 3, matches: 20 },
}

describe('admin console commands', () => {
  it('handles help and clear locally', async () => {
    const getStats = vi.fn(async () => stats)

    await expect(runAdminConsoleCommand('help', getStats)).resolves.toEqual({
      action: 'append',
      lines: [
        'Available commands: help, status, clear',
        'Commands are allowlisted. Shell, SQL, and arbitrary code are disabled.',
      ],
    })
    await expect(runAdminConsoleCommand('clear', getStats)).resolves.toEqual({
      action: 'clear',
      lines: [],
    })
    expect(getStats).not.toHaveBeenCalled()
  })

  it('loads status from the admin API and formats player-service counts', async () => {
    const getStats = vi.fn(async () => stats)

    await expect(runAdminConsoleCommand('status', getStats)).resolves.toEqual({
      action: 'append',
      stats,
      lines: [
        'Online players: 4 (4 named; 2 accounts, 2 guests)',
        'Queue: 1 · Pending lobbies: 1 · Active matches: 1',
        'Stored: 8 accounts · 3 active sessions · 20 matches',
      ],
    })
    expect(getStats).toHaveBeenCalledOnce()
  })

  it('rejects unknown and argument-bearing commands without executing anything', async () => {
    const getStats = vi.fn(async () => stats)

    await expect(
      runAdminConsoleCommand('delete accounts', getStats),
    ).resolves.toEqual({
      action: 'append',
      lines: ['Unknown command. Type help to list safe commands.'],
    })
    expect(getStats).not.toHaveBeenCalled()
  })
})
