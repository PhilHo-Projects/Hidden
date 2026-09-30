import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { CubeBoard3D } from '../CubeBoard3D'
import { IDENTITY, turn, type Orientation } from '../orientation'

// The canvas half is WebGL and is exercised in the browser, not here.
vi.mock('../lazy', () => ({
  LazyBoardCanvas: () => null,
  LazyMiniCanvas: () => null,
  preloadCube3D: () => undefined,
}))

const grid = {
  cells: Array.from({ length: 54 }, () => ({
    occupied: false,
    symbol: null,
    immune: false,
    desecrated: false,
  })),
}

const render = (orientation: Orientation, selectedSymbol: 'rock' | null = null) =>
  renderToStaticMarkup(
    createElement(CubeBoard3D, {
      subtitle: 'Phil',
      grid,
      orientation,
      interactive: true,
      selectedSymbol,
      destructionEffects: {},
      onSelect: () => {},
      onTurn: () => {},
      onUseFlat: () => {},
    }),
  )

describe('the 3D board frame', () => {
  it('builds the same structure the arena sizes a flat board by', () => {
    // `useBoardSideVar` measures `.hidden-board .hidden-board-grid`, and the
    // arena's rules reach the grid through `.face-frame`. Matching them is what
    // lets the caption, arrows and peek line up without new layout code.
    const markup = render(IDENTITY)
    expect(markup).toContain('class="hidden-board cube3d-board hidden-board-interactive"')
    expect(markup).toContain('face-frame')
    expect(markup).toContain('hidden-board-grid cube3d-stage')
    expect(markup).toContain('Phil')
  })

  it('labels its arrows by what is on screen, not by the flat table', () => {
    const rolled = turn(turn(IDENTITY, 'east'), 'north')
    const labels = [...render(rolled).matchAll(/aria-label="Move to ([A-Z]+)"/g)].map((m) => m[1])
    expect(labels).toEqual(['LEFT', 'BACK', 'RIGHT', 'HOME'])
  })

  it('offers both rolls', () => {
    const markup = render(IDENTITY)
    expect(markup).toContain('aria-label="Roll the cube counter-clockwise"')
    expect(markup).toContain('aria-label="Roll the cube clockwise"')
  })

  it('shows the loaded move, like the flat board', () => {
    expect(render(IDENTITY, 'rock')).toContain('Loaded')
    expect(render(IDENTITY)).not.toContain('Loaded')
  })
})
