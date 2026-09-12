import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CubeNet } from '../CubeNet'
import type { GridState } from '../../game/types'

const grid: GridState = {
  cells: Array.from({ length: 54 }, (_, index) => ({
    occupied: index === 53,
    symbol: index === 53 ? ('paper' as const) : null,
    immune: false,
    desecrated: false,
  })),
}

describe('the result net', () => {
  it('draws six three-column faces', () => {
    const markup = renderToStaticMarkup(
      createElement(CubeNet, { subtitle: 'Player', grid }),
    )

    expect(markup.match(/--board-size:3/g)).toHaveLength(6)
    expect(markup).not.toContain('--board-size:7')
  })

  it('keeps true location ids across the net', () => {
    const markup = renderToStaticMarkup(
      createElement(CubeNet, { subtitle: 'Player', grid, scoreCountLabels: { 53: 1 } }),
    )

    expect(markup).toContain('aria-label="Cell 54, Point 1"')
  })

  it('names every face', () => {
    const markup = renderToStaticMarkup(
      createElement(CubeNet, { subtitle: 'Player', grid }),
    )

    for (const label of ['HOME', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'BACK']) {
      expect(markup).toContain(label)
    }
  })
})
