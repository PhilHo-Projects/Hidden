import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BoardGrid } from '../BoardGrid'
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
    ['rock', '#A6E22E'],
    ['paper', '#4591DB'],
    ['scissors', '#CC3941'],
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

    expect(markup).not.toContain('#A6E22E')
  })
})
