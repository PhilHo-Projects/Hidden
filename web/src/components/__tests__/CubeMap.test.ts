import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CubeMap } from '../CubeMap'
import type { CubeFace } from '@hidden/game-core'

const counts: Record<CubeFace, number> = {
  home: 3,
  up: 0,
  down: 1,
  left: 0,
  right: 0,
  back: 9,
}

const render = (face: CubeFace, locked: boolean) =>
  renderToStaticMarkup(
    createElement(CubeMap, {
      face,
      locked,
      cellCounts: counts,
      onJump: () => {},
      onToggleLock: () => {},
    }),
  )

describe('the map', () => {
  it('lays out all six faces', () => {
    const markup = render('home', false)

    for (const label of ['HOME', 'UP', 'DOWN', 'LEFT', 'RIGHT', 'BACK']) {
      expect(markup).toContain(label)
    }
  })

  it('marks where you are', () => {
    const markup = render('right', false)

    expect(markup).toContain('cube-map-face-current')
    expect(markup).toContain('aria-current="true"')
  })

  it('shows how many cells you hold on each face', () => {
    // The player's own placements. Nothing here is the opponent's, so the map
    // leaks nothing a blind board is hiding.
    expect(render('home', false)).toContain('>9<')
  })

  it('stops being a jump target while navigation is locked', () => {
    const markup = render('home', true)

    expect(markup).toContain('cube-map-locked')
    expect(markup.match(/<button[^>]*disabled/g)).toHaveLength(6)
  })
})

describe('the padlock', () => {
  it('reports open state in words as well as colour', () => {
    const markup = render('home', false)

    expect(markup).toContain('aria-pressed="false"')
    expect(markup).toContain('OPEN')
    expect(markup).not.toContain('padlock-locked')
  })

  it('reports locked state in words as well as colour', () => {
    const markup = render('home', true)

    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('LOCKED')
    expect(markup).toContain('padlock-locked')
  })

  it('stays usable while navigation is locked, or there is no way back', () => {
    const padlock = render('home', true).match(/<button[^>]*class="padlock[^>]*>/)

    expect(padlock).not.toBeNull()
    expect(padlock?.[0]).not.toContain('disabled')
  })
})
