import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BoardGrid } from '../BoardGrid'
import { PowerupTray } from '../PowerupTray'
import type { GridState, PowerupState } from '../../game/types'

const emptyGrid: GridState = {
  cells: Array.from({ length: 9 }, () => ({
    occupied: false,
    symbol: null,
    immune: false,
    desecrated: false,
  })),
}

const lockedPowerups: PowerupState = {
  unlocked: { shield: false, reveal: false, extraTurn: false },
  used: { shield: false, reveal: false, extraTurn: false },
  revealActive: false,
  extraTurnArmed: false,
}

describe('battle UI', () => {
  it('labels the third powerup Extra turn', () => {
    const markup = renderToStaticMarkup(
      createElement(PowerupTray, {
        powerups: lockedPowerups,
        disabled: false,
        onUse: () => undefined,
      }),
    )

    expect(markup).toContain('Extra turn')
    expect(markup).not.toContain('Play again')
  })

  it('renders a board-local destruction effect with its combat tone', () => {
    const markup = renderToStaticMarkup(
      createElement(BoardGrid, {
        title: 'Player Board',
        subtitle: 'Guest#1234',
        grid: emptyGrid,
        destructionEffects: {
          4: { id: 12, tone: 'loss' },
        },
      }),
    )

    expect(markup).toContain('cell-destruction-loss')
    expect(markup).toContain('cell-destruction__shard')
  })

  it('numbers occupied result cells in score order without a redundant board title', () => {
    const scoredGrid: GridState = {
      cells: emptyGrid.cells.map((cell, index) =>
        index === 1 || index === 7
          ? { occupied: true, symbol: 'paper' as const, immune: false, desecrated: false }
          : cell,
      ),
    }
    const markup = renderToStaticMarkup(
      createElement(BoardGrid, {
        title: '',
        subtitle: 'Guest#1234',
        grid: scoredGrid,
        scoreCountLabels: { 1: 1, 7: 2 },
      }),
    )

    expect(markup).not.toContain('Final Board')
    expect(markup).toContain('score-count-badge')
    expect(markup).toContain('Point 1')
    expect(markup).toContain('Point 2')
    expect(markup).toContain('--score-order:1')
    expect(markup).toContain('--score-order:2')
  })

  it('staggers the result count-up slowly enough to read one cell at a time', () => {
    const scoredGrid: GridState = {
      cells: emptyGrid.cells.map((cell, index) =>
        index === 0 || index === 4
          ? { occupied: true, symbol: 'paper' as const, immune: false, desecrated: false }
          : cell,
      ),
    }
    const markup = renderToStaticMarkup(
      createElement(BoardGrid, {
        title: '',
        subtitle: 'Guest#1234',
        grid: scoredGrid,
        scoreCountLabels: { 0: 1, 4: 2 },
      }),
    )

    expect(markup).toContain('--score-delay:500ms')
    expect(markup).toContain('--score-badge-delay:590ms')
    expect(markup).toContain('--score-delay:840ms')
    expect(markup).toContain('--score-badge-delay:930ms')
  })

  it('leaves unscored cells without a count-up delay', () => {
    const markup = renderToStaticMarkup(
      createElement(BoardGrid, {
        title: '',
        subtitle: 'Guest#1234',
        grid: emptyGrid,
      }),
    )

    expect(markup).not.toContain('hidden-cell-score-counted')
    expect(markup).toContain('--score-delay:0ms')
  })
})
