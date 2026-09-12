import { deepFreeze, type BoardSize, type LocationId } from './config.ts'

/**
 * What a board *is*: the set of playable location IDs, and the lines that
 * unlock a power-up when one is completed.
 *
 * The only module in the package that knows a board has a shape. Every reducer
 * function in `index.ts` operates on opaque IDs and on `winningPatterns`, which
 * is data — which is why a cube needs a builder here and nothing else.
 */

export interface ClassicTopology {
  readonly locationIds: readonly LocationId[]
  readonly winningPatterns: readonly (readonly LocationId[])[]
}

// Pattern order is load-bearing: `maybeUnlockPowerup` returns on the first
// match, so reordering changes which power-up unlocks when two lines complete
// on the same turn. The 3x3 output is asserted against the legacy order.
export function createTopology(
  boardSize: BoardSize,
  streak: number,
): ClassicTopology {
  if (!Number.isInteger(streak) || streak < 2 || streak > boardSize) {
    throw new Error(
      `Invalid streak ${streak} for a ${boardSize}x${boardSize} board.`,
    )
  }

  const locationIds: LocationId[] = []
  for (let index = 0; index < boardSize * boardSize; index += 1) {
    locationIds.push(index)
  }

  const at = (row: number, column: number) => row * boardSize + column
  const offsets: number[] = []
  for (let step = 0; step < streak; step += 1) offsets.push(step)
  const windows = boardSize - streak + 1
  const winningPatterns: LocationId[][] = []

  for (let row = 0; row < boardSize; row += 1) {
    for (let column = 0; column < windows; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row, column + step)))
    }
  }
  for (let column = 0; column < boardSize; column += 1) {
    for (let row = 0; row < windows; row += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column)))
    }
  }
  for (let row = 0; row < windows; row += 1) {
    for (let column = 0; column < windows; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column + step)))
    }
  }
  for (let row = 0; row < windows; row += 1) {
    for (let column = streak - 1; column < boardSize; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column - step)))
    }
  }

  return deepFreeze({ locationIds, winningPatterns })
}
