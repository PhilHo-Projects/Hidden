import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { HowToPlayModal, HowToPlayTrigger } from '../HowToPlayModal'

const render = (overrides: Partial<Parameters<typeof HowToPlayModal>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(HowToPlayModal, {
      open: true,
      onClose: () => undefined,
      ...overrides,
    }),
  )

describe('HowToPlayModal', () => {
  it('renders nothing while closed', () => {
    // Absent rather than hidden, matching ProfileMenu: a closed dialog must not
    // leave unreachable content in the tree.
    expect(render({ open: false })).toBe('')
  })

  it('announces itself as a modal dialog labelled by its heading', () => {
    const markup = render()

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('aria-modal="true"')
    expect(markup).toContain('aria-labelledby=')
  })

  it('states all four rules', () => {
    const markup = render()

    // Asserted without the apostrophe: renderToStaticMarkup escapes it.
    expect(markup).toContain('see their board')
    expect(markup).toContain('Every square is rock, paper, scissors')
    expect(markup).toContain('Most squares held wins')
    expect(markup).toContain('Complete a line to unlock a power-up')
  })

  it('says the rules are still being tuned', () => {
    expect(render()).toContain('still being tuned')
  })

  /*
   * The copy has to stay true for every GameConfig. boardSize, streak, and
   * powerupBySymbol are all configurable, so naming a line length or claiming a
   * symbol unlocks a particular power-up would make the modal lie in any
   * non-default game.
   */
  it('commits to no streak length the config can change', () => {
    const markup = render()

    expect(markup).not.toMatch(/three in a row/i)
    expect(markup).not.toMatch(/3 in a row/i)
  })

  it('commits to no symbol-to-power-up mapping the config can change', () => {
    const markup = render()

    expect(markup).not.toMatch(/rock (unlocks|gives|grants)/i)
    expect(markup).not.toMatch(/paper (unlocks|gives|grants)/i)
    expect(markup).not.toMatch(/scissors (unlocks|gives|grants)/i)
  })

  it('offers a close control', () => {
    expect(render()).toContain('aria-label="Close"')
  })
})

describe('HowToPlayTrigger', () => {
  it('carries an accessible name rather than relying on the card art', () => {
    const markup = renderToStaticMarkup(
      createElement(HowToPlayTrigger, { onClick: () => undefined }),
    )

    expect(markup).toContain('aria-label="How to play"')
    // The fanned cards are decoration; the name above is the only label.
    expect(markup).toContain('aria-hidden="true"')
  })
})
