import { describe, expect, it } from 'vitest'
import type { Logger } from '../logger'
import type { MatchHistoryRecordV1 } from './types'
import { MatchHistoryRecorder } from './recorder'

const record: MatchHistoryRecordV1 = {
  schemaVersion: 1,
  matchId: '00000000-0000-4000-8000-000000000101',
  completedAtMs: Date.parse('2030-01-01T00:00:00.000Z'),
  engine: { id: 'classic', revision: 2 },
  config: {
    boardSize: 3,
    streak: 3,
    rounds: 1,
    turnSeconds: 10,
    blindMode: false,
    powerupsEnabled: true,
    powerups: { shield: true, reveal: true, extraTurn: true },
    powerupBySymbol: {
      rock: 'shield',
      paper: 'reveal',
      scissors: 'extraTurn',
    },
  },
  turnCount: 2,
  participants: [
    { seat: 0, accountId: '00000000-0000-4000-8000-000000000001', username: 'One' },
    { seat: 1, accountId: '00000000-0000-4000-8000-000000000002', username: 'Two' },
  ],
  result: { scores: [1, 1], winner: null },
  boards: [
    { columns: 3, cells: [{ locationId: 0, symbol: 'rock' }] },
    { columns: 3, cells: [{ locationId: 0, symbol: null }] },
  ],
}

describe('MatchHistoryRecorder', () => {
  it('retries a failed insert twice with bounded backoff and flushes the success', async () => {
    let attempts = 0
    const delays: number[] = []
    const logs: Parameters<Logger>[] = []
    const recorder = new MatchHistoryRecorder(
      {
        async insert() {
          attempts += 1
          if (attempts < 3) throw new Error('temporary database failure')
        },
      },
      (...entry) => logs.push(entry),
      async (delayMs) => {
        delays.push(delayMs)
      },
    )

    expect(recorder.record(record)).toBeUndefined()
    await recorder.flush()

    expect(attempts).toBe(3)
    expect(delays).toEqual([250, 1_000])
    expect(logs).toEqual([])
  })

  it('contains final failure logs to identifiers and error class', async () => {
    let attempts = 0
    const logs: Parameters<Logger>[] = []
    const recorder = new MatchHistoryRecorder(
      {
        async insert() {
          attempts += 1
          throw new TypeError('contains-sensitive-message')
        },
      },
      (...entry) => logs.push(entry),
      async () => undefined,
    )

    recorder.record(record)
    await recorder.flush()

    expect(attempts).toBe(3)
    expect(logs).toEqual([
      [
        'error',
        'match_history.record_failed',
        {
          matchId: '00000000-0000-4000-8000-000000000101',
          errorClass: 'TypeError',
        },
      ],
    ])
    expect(JSON.stringify(logs)).not.toContain('contains-sensitive-message')
    expect(JSON.stringify(logs)).not.toContain('powerupBySymbol')
  })
})
