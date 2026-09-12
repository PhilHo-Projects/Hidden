/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest'
import { PLAYED_BOARD_GRID_SELECTOR } from '../useBoardSideVar'

function arena(playedBoardInner: string) {
  const element = document.createElement('div')
  element.className = 'battle-arena'
  element.innerHTML = `
    <section class="hidden-board">
      <header class="hidden-board-header"></header>
      ${playedBoardInner}
    </section>
    <aside class="opponent-peek">
      <section class="hidden-board">
        <div class="hidden-board-grid" data-board="peek"></div>
      </section>
    </aside>
  `
  return element
}

describe('the played board selector', () => {
  it('finds an unframed board', () => {
    const found = arena(
      '<div class="hidden-board-grid" data-board="played"></div>',
    ).querySelector(PLAYED_BOARD_GRID_SELECTOR)

    expect(found?.getAttribute('data-board')).toBe('played')
  })

  it('finds a board framed by the face arrows', () => {
    const found = arena(
      '<div class="face-frame"><div class="hidden-board-grid" data-board="played"></div></div>',
    ).querySelector(PLAYED_BOARD_GRID_SELECTOR)

    expect(found?.getAttribute('data-board')).toBe('played')
  })

  it('never picks the opponent peek', () => {
    // The peek and the reveal snapshot are siblings of the played board, not
    // descendants of it. That is the whole reason the selector can afford to
    // stop being a direct-child chain.
    expect(arena('').querySelector(PLAYED_BOARD_GRID_SELECTOR)).toBeNull()
  })
})
