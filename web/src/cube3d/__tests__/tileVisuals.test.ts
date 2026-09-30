import { describe, expect, it } from 'vitest'
import { COLOR_BY_SYMBOL } from '../../game/constants'
import type { CellState } from '../../game/types'
import {
  DESECRATED_TILE_COLOR,
  EMPTY_TILE_COLOR,
  UNKNOWN_PIECE_COLOR,
  sameTileVisual,
  tileVisual,
} from '../tileVisuals'

const cell = (overrides: Partial<CellState> = {}): CellState => ({
  occupied: false,
  symbol: null,
  immune: false,
  desecrated: false,
  ...overrides,
})

describe('tile visuals', () => {
  it('draws an empty cell as bare paper', () => {
    expect(tileVisual(cell())).toEqual({ kind: 'empty', color: EMPTY_TILE_COLOR, shielded: false })
  })

  it('draws a piece in its symbol colour, the same colours the flat board uses', () => {
    for (const symbol of ['rock', 'paper', 'scissors'] as const) {
      expect(tileVisual(cell({ occupied: true, symbol }))).toEqual({
        kind: 'piece',
        color: COLOR_BY_SYMBOL[symbol],
        shielded: false,
      })
    }
  })

  it('marks a shielded piece', () => {
    expect(tileVisual(cell({ occupied: true, symbol: 'rock', immune: true })).shielded).toBe(true)
  })

  it('draws a desecrated empty cell as spoiled, matching the flat board', () => {
    expect(tileVisual(cell({ desecrated: true }))).toEqual({
      kind: 'desecrated',
      color: DESECRATED_TILE_COLOR,
      shielded: false,
    })
  })

  it('lets a piece win over a stale desecrated flag, as BoardGrid does', () => {
    expect(tileVisual(cell({ occupied: true, symbol: 'paper', desecrated: true })).kind).toBe('piece')
  })

  it('never crashes on a piece with no known symbol', () => {
    expect(tileVisual(cell({ occupied: true })).color).toBe(UNKNOWN_PIECE_COLOR)
  })

  it('compares by value', () => {
    expect(sameTileVisual(tileVisual(cell()), tileVisual(cell()))).toBe(true)
    expect(sameTileVisual(tileVisual(cell()), tileVisual(cell({ desecrated: true })))).toBe(false)
  })
})
