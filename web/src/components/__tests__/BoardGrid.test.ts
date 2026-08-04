import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BoardGrid } from '../BoardGrid'
import type { GridState } from '../../game/types'

const gridOf = (count: number): GridState => ({
  cells: Array.from({ length: count }, () => ({
    occupied: false,
    color: null,
    immune: false,
  })),
})

const markupFor = (count: number) =>
  renderToStaticMarkup(
    createElement(BoardGrid, { title: '', subtitle: 'Board', grid: gridOf(count) }),
  )

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
