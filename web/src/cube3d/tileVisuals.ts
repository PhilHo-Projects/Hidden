import { COLOR_BY_SYMBOL } from '../game/constants'
import type { CellState } from '../game/types'

/*
 * What a tile on the 3D cube should look like, decided without WebGL so it can
 * be tested. The scene diffs these and animates the difference.
 *
 * The precedence copies `BoardGrid`: a piece wins, and a cell is only drawn
 * desecrated while it is empty.
 */

export type TileKind = 'empty' | 'piece' | 'desecrated'

export interface TileVisual {
  readonly kind: TileKind
  readonly color: string
  readonly shielded: boolean
}

/** The model's own paper tone, so an empty tile looks as Blender made it. */
export const EMPTY_TILE_COLOR = '#e8e2d4'
/** Paper gone to ash: still a tile, visibly not one to use this turn. */
export const DESECRATED_TILE_COLOR = '#6f6a61'
/** Defensive. Your own board always knows its symbols. */
export const UNKNOWN_PIECE_COLOR = '#2a2a2a'

export function tileVisual(cell: CellState): TileVisual {
  if (cell.occupied) {
    return {
      kind: 'piece',
      color: cell.symbol ? COLOR_BY_SYMBOL[cell.symbol] : UNKNOWN_PIECE_COLOR,
      shielded: cell.immune,
    }
  }
  if (cell.desecrated) {
    return { kind: 'desecrated', color: DESECRATED_TILE_COLOR, shielded: false }
  }
  return { kind: 'empty', color: EMPTY_TILE_COLOR, shielded: false }
}

export function sameTileVisual(a: TileVisual, b: TileVisual): boolean {
  return a.kind === b.kind && a.color === b.color && a.shielded === b.shielded
}
