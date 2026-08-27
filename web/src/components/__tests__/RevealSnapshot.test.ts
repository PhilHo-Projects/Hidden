import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RevealSnapshot } from '../RevealSnapshot'
import type { GridState } from '../../game/types'

const opponentGrid: GridState = {
  cells: [
    { occupied: true, symbol: 'rock', immune: false, desecrated: false },
    { occupied: false, symbol: null, immune: false, desecrated: false },
    { occupied: true, symbol: 'paper', immune: false, desecrated: false },
    { occupied: false, symbol: null, immune: false, desecrated: true },
  ],
}

const render = (open: boolean) =>
  renderToStaticMarkup(
    createElement(RevealSnapshot, {
      open,
      opponentName: 'Guest#0427',
      grid: opponentGrid,
      seconds: 1.5,
      onClose: () => undefined,
    }),
  )

describe('reveal snapshot', () => {
  it('renders nothing while no reveal is running', () => {
    expect(render(false)).toBe('')
  })

  it('says whose board it is', () => {
    /*
     * Load-bearing, not decoration. Both boards in this game are drawn
     * identically, so a snapshot that does not name its owner can be read as
     * the player's own -- which is the exact opposite of the truth, and would
     * send them to play against their own layout.
     */
    const markup = render(true)

    expect(markup).toContain("OPPONENT&#x27;S BOARD")
    expect(markup).toContain('Guest#0427')
  })

  it('is a modal dialog', () => {
    const markup = render(true)

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
  })

  it('starts with every bulb lit', () => {
    // The frame is the countdown, so at the moment it opens nothing has burned
    // down yet. An unlit bulb here would be time the player never had.
    const markup = render(true)

    // Anchored on the attribute so the `reveal-bulbs` container does not count
    // itself as a bulb. 11 across and 17 down, twice.
    expect(markup.match(/class="reveal-bulb[ "]/g)?.length).toBe(56)
    expect(markup).not.toContain('reveal-bulb-off')
    expect(markup).not.toContain('reveal-frame-urgent')
  })

  it('offers a way out before the window ends', () => {
    expect(render(true)).toContain('reveal-dismiss')
  })

  it('leaves desecration off the snapshot', () => {
    // Desecration constrains the opponent's next move, not the player's. It is
    // noise on a board they have a second and a half to memorise.
    expect(render(true)).not.toContain('cell-desecration')
  })
})
