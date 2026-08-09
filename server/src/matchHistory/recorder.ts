import type { Logger } from '../logger'
import type { MatchHistoryRecordV1 } from './types'

export interface MatchHistoryRecordStore {
  insert(record: MatchHistoryRecordV1): Promise<void>
}

type Delay = (delayMs: number) => Promise<void>

const RETRY_DELAYS_MS = [250, 1_000] as const

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

  constructor(
    private readonly store: MatchHistoryRecordStore,
    private readonly logger: Logger,
    private readonly delay: Delay = defaultDelay,
  ) {}

  record(record: MatchHistoryRecordV1): void {
    const operation = this.persist(record).finally(() => {
      this.pending.delete(operation)
    })
    this.pending.add(operation)
  }

  async flush(): Promise<void> {
    await Promise.all([...this.pending])
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
        this.logger('error', 'match_history.record_failed', {
          matchId: record.matchId,
          errorClass: errorClass(error),
          attempts: attempt + 1,
        })
      }
    }
  }
}
