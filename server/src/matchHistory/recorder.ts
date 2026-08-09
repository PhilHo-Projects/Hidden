import type { Logger } from '../logger'
import type { MatchHistoryRecordV1 } from './types'

export interface MatchHistoryRecordStore {
  insert(record: MatchHistoryRecordV1): Promise<void>
}

type Delay = (delayMs: number) => Promise<void>

const RETRY_DELAYS_MS = [250, 1_000] as const
const DEFAULT_MAX_CONCURRENT_WRITES = 4
const DEFAULT_MAX_PENDING_WRITES = 256

interface PendingWrite {
  operation: Promise<void>
  record: MatchHistoryRecordV1
  resolve: () => void
}

function defaultDelay(delayMs: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

function errorClass(error: unknown) {
  return error instanceof Error ? error.name : typeof error
}

export class MatchHistoryRecorder {
  private readonly pending = new Set<Promise<void>>()
  private readonly queue: PendingWrite[] = []
  private activeWrites = 0

  constructor(
    private readonly store: MatchHistoryRecordStore,
    private readonly logger: Logger,
    private readonly delay: Delay = defaultDelay,
    private readonly maxConcurrentWrites = DEFAULT_MAX_CONCURRENT_WRITES,
    private readonly maxPendingWrites = DEFAULT_MAX_PENDING_WRITES,
  ) {
    if (!Number.isSafeInteger(maxConcurrentWrites) || maxConcurrentWrites < 1) {
      throw new RangeError('maxConcurrentWrites must be a positive integer')
    }
    if (!Number.isSafeInteger(maxPendingWrites) || maxPendingWrites < 1) {
      throw new RangeError('maxPendingWrites must be a positive integer')
    }
  }

  record(record: MatchHistoryRecordV1): void {
    if (this.pending.size >= this.maxPendingWrites) {
      this.safeLog('match_history.record_dropped', record, 'RecorderCapacityExceeded')
      return
    }

    let resolve!: () => void
    const operation = new Promise<void>((settle) => {
      resolve = settle
    })
    this.pending.add(operation)
    this.queue.push({ operation, record, resolve })
    this.drain()
  }

  async flush(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending])
    }
  }

  private drain() {
    while (
      this.activeWrites < this.maxConcurrentWrites &&
      this.queue.length > 0
    ) {
      const pendingWrite = this.queue.shift()
      if (!pendingWrite) return
      this.activeWrites += 1
      void this.persist(pendingWrite.record)
        .catch((error) => {
          this.safeLog(
            'match_history.record_failed',
            pendingWrite.record,
            errorClass(error),
          )
        })
        .finally(() => {
          this.activeWrites -= 1
          this.pending.delete(pendingWrite.operation)
          pendingWrite.resolve()
          this.drain()
        })
    }
  }

  private async persist(record: MatchHistoryRecordV1) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await this.store.insert(record)
        return
      } catch (error) {
        const retryDelay = RETRY_DELAYS_MS[attempt]
        if (retryDelay !== undefined) {
          await this.delay(retryDelay)
          continue
        }
        this.safeLog('match_history.record_failed', record, errorClass(error))
      }
    }
  }

  private safeLog(
    event: 'match_history.record_dropped' | 'match_history.record_failed',
    record: MatchHistoryRecordV1,
    failureClass: string,
  ) {
    try {
      this.logger('error', event, {
        matchId: record.matchId,
        errorClass: failureClass,
      })
    } catch {
      // Persistence and logging are both best-effort off the game-over path.
    }
  }
}
