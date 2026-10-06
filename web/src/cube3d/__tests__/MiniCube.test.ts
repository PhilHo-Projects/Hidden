import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MiniCube } from '../MiniCube'
import { IDENTITY } from '../orientation'

vi.mock('../lazy', () => ({
  LazyBoardCanvas: () => null,
  LazyMiniCanvas: () => null,
  preloadCube3D: () => undefined,
}))

describe('the mini cube panel', () => {
  it('names itself and says how to use it', () => {
    const markup = renderToStaticMarkup(
      createElement(MiniCube, {
        grid: { cells: [] },
        activeFace: 'home',
        orientation: IDENTITY,
        onJump: () => {},
      }),
    )
    expect(markup).toContain('aria-label="Cube"')
    expect(markup).toContain('CUBE')
    expect(markup).toContain('Drag to spin')
  })
})
