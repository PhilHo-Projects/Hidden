import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BoardGrid } from '../BoardGrid'
import { diffCellInk } from '../cellInk'
import type { ClassicSymbol } from '@hidden/game-core'
import type { GridState } from '../../game/types'

const gridOf = (count: number): GridState => ({
  cells: Array.from({ length: count }, () => ({
    occupied: false,
    symbol: null,
    immune: false,
    desecrated: false,
  })),
})

const gridWith = (symbol: ClassicSymbol): GridState => ({
  cells: [{ occupied: true, symbol, immune: false, desecrated: false }],
})

const markupFor = (count: number) =>
  renderToStaticMarkup(
    createElement(BoardGrid, { title: '', subtitle: 'Board', grid: gridOf(count) }),
  )

describe('desecrated cells', () => {
  const desecratedGrid: GridState = {
    cells: [
      { occupied: false, symbol: null, immune: false, desecrated: true },
      { occupied: false, symbol: null, immune: false, desecrated: false },
    ],
  }

  const render = (showDesecration?: boolean) =>
    renderToStaticMarkup(
      createElement(BoardGrid, {
        title: '',
        subtitle: 'Board',
        grid: desecratedGrid,
        ...(showDesecration === undefined ? {} : { showDesecration }),
      }),
    )

  it('paints a desecrated cell with its own overlay', () => {
    const markup = render()

    expect(markup).toContain('hidden-cell-desecrated')
    expect(markup.match(/cell-desecration/g)).toHaveLength(1)
  })

  it('leaves desecration off the result boards', () => {
    // Scoring a finished match has no next move to constrain, so the brown
    // would read as a third cell state next to occupied and empty.
    const markup = render(false)

    expect(markup).not.toContain('hidden-cell-desecrated')
    expect(markup).not.toContain('cell-desecration')
  })
})

describe('board grid sizing', () => {
  it.each([
    [9, '3'],
    [16, '4'],
    [25, '5'],
  ])('renders %i cells as a %s-column grid', (count, columns) => {
    expect(markupFor(count)).toContain(`--board-size:${columns}`)
  })

  it('falls back to three columns for an empty setup-phase grid', () => {
    // Setup renders before the core has built a board, so cells is empty.
    expect(markupFor(0)).toContain('--board-size:3')
  })
})

/*
 * Presentation state carries the symbol; the colour is resolved here, at the
 * only boundary that still knows the correspondence. These pin the three pairs
 * so a re-skin has to be deliberate rather than a silent swap of two moves.
 */
describe('board grid symbol colours', () => {
  it.each([
    ['rock', '#6EDC3C'],
    ['paper', '#4C6EF5'],
    ['scissors', '#DC2626'],
  ] as const)('paints a %s cell %s', (symbol, hex) => {
    const markup = renderToStaticMarkup(
      createElement(BoardGrid, {
        title: '',
        subtitle: 'Board',
        grid: gridWith(symbol),
      }),
    )

    expect(markup).toContain(`background:${hex}`)
  })

  it('hides an occupied cell behind the blind-mode tone rather than its colour', () => {
    const markup = renderToStaticMarkup(
      createElement(BoardGrid, {
        title: '',
        subtitle: 'Board',
        grid: gridWith('rock'),
        hidden: true,
      }),
    )

    expect(markup).not.toContain('#6EDC3C')
  })

  /*
   * The colour moved off the cell face and onto a layer of its own so it can
   * grow and drain over the empty face underneath. The face has to keep showing
   * the empty tone, or a fill would grow out of its own colour and show nothing.
   */
  it('paints the colour on the ink layer over an empty cell face', () => {
    const markup = renderToStaticMarkup(
      createElement(BoardGrid, {
        title: '',
        subtitle: 'Board',
        grid: gridWith('rock'),
      }),
    )

    expect(markup).toContain('cell-ink')
    expect(markup).toContain('background:#f5f5f5')
    expect(markup).toContain('background:#6EDC3C')
  })

  // Results boards and the revealed opponent peek mount with the ink already
  // down. Nine cells filling at once on arrival is noise, not feedback.
  it('does not fill a board that mounts already occupied', () => {
    const markup = renderToStaticMarkup(
      createElement(BoardGrid, {
        title: '',
        subtitle: 'Board',
        grid: gridWith('rock'),
      }),
    )

    expect(markup).not.toContain('cell-ink-fill')
    expect(markup).not.toContain('cell-ink-drain')
  })
})

/*
 * The transition, not the frame. Which cells fill and which drain is decided by
 * comparing two tone keys, and a drain has to carry the tone forward because the
 * cell it belonged to is already empty by the time the animation runs.
 */
describe('cell ink transitions', () => {
  it('fills a cell that gained a tone', () => {
    expect(diffCellInk('||', '|#6EDC3C|')).toEqual({
      filled: [1],
      drained: [],
    })
  })

  it('drains a cell that lost one, carrying the tone it lost', () => {
    expect(diffCellInk('#DC2626|#4C6EF5', '#DC2626|')).toEqual({
      filled: [],
      drained: [[1, '#4C6EF5']],
    })
  })

  it('reports nothing when the board is unchanged', () => {
    expect(diffCellInk('#6EDC3C|', '#6EDC3C|')).toEqual({
      filled: [],
      drained: [],
    })
  })

  // A contested square is destroyed rather than overwritten, so this should not
  // arise in play; treating it as neither is still the honest answer, because
  // the layer is already down and only its colour changed.
  it('treats a tone swapped in place as neither a fill nor a drain', () => {
    expect(diffCellInk('#6EDC3C', '#DC2626')).toEqual({
      filled: [],
      drained: [],
    })
  })

  /*
   * Only a change of board size does this, and that is a different board rather
   * than a move on this one. Reporting the extra cells would fill or drain a
   * whole grid at once on a rule change.
   */
  it('reports nothing for cells outside the overlap when the board resizes', () => {
    expect(diffCellInk('#6EDC3C', '#6EDC3C|#4C6EF5')).toEqual({
      filled: [],
      drained: [],
    })
    expect(diffCellInk('#6EDC3C|#4C6EF5', '#6EDC3C')).toEqual({
      filled: [],
      drained: [],
    })
  })
})
