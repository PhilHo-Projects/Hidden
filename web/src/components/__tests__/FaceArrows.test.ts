/** @vitest-environment jsdom */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { FaceArrows } from '../FaceArrows'
import type { FaceDirection } from '@hidden/game-core'

const render = (locked: boolean) =>
  renderToStaticMarkup(
    createElement(FaceArrows, { face: 'home' as const, locked, onMove: () => {} }),
  )

describe('face arrows', () => {
  it('draws one per side', () => {
    const markup = render(false)

    for (const direction of ['north', 'east', 'south', 'west']) {
      expect(markup).toContain(`face-arrow-${direction}`)
    }
  })

  it('names its destination', () => {
    // The adjacency table is public geometry, so saying where an arrow goes
    // leaks nothing and is the only way the control has an accessible name.
    const markup = render(false)

    expect(markup).toContain('aria-label="Move to UP"')
    expect(markup).toContain('aria-label="Move to RIGHT"')
  })

  it('stays visible and stops working when navigation is locked', () => {
    // Not hidden. A missing arrow reads as "no face there", which is wrong on a
    // cube where every face has four neighbours.
    const markup = render(true)

    expect(markup).toContain('face-arrow-locked')
    expect(markup.match(/disabled/g)).toHaveLength(4)
    expect(markup).toContain('face-arrow-north')
  })

  it('is enabled when navigation is open', () => {
    const markup = render(false)

    expect(markup).not.toContain('disabled')
    expect(markup).not.toContain('face-arrow-locked')
  })
})

describe('tapping an arrow', () => {
  let root: Root | null = null
  let container: HTMLDivElement | null = null

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    root = null
    container = null
  })

  const mount = (locked: boolean) => {
    const moves: FaceDirection[] = []
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(
        createElement(FaceArrows, {
          face: 'home' as const,
          locked,
          onMove: (direction: FaceDirection) => moves.push(direction),
        }),
      )
    })
    return moves
  }

  const tap = (direction: FaceDirection) => {
    act(() => {
      container
        ?.querySelector<HTMLButtonElement>(`.face-arrow-${direction}`)
        ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
    })
  }

  it.each(['north', 'east', 'south', 'west'] as const)(
    'reports %s, the same vocabulary the keyboard uses',
    (direction) => {
      // `useFaceCamera` hands both this callback and `directionForKey` to the
      // same `move`, so proving the tap emits the same name is what makes the
      // three input paths equivalent rather than merely similar.
      const moves = mount(false)

      tap(direction)
      expect(moves).toEqual([direction])
    },
  )

  it('reports nothing while navigation is locked', () => {
    const moves = mount(true)

    tap('north')
    expect(moves).toEqual([])
  })
})
