import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * The rule protected here is a cascade fact, not a markup fact, so it is
 * asserted against the stylesheet the way `assetPaths` is.
 *
 * `.hidden-cell` draws its hand-cut outline and drop stack as a `filter` chain.
 * `filter` is a single property, and an animation outranks a normal
 * declaration, so a keyframe setting `brightness()` on the cell replaces the
 * whole chain and the cell loses its ink for as long as the animation exists.
 * The result walk loops forever, so every scored cell on the results screen lost
 * its outline permanently, on every browser.
 *
 * Nothing rendered catches that. jsdom does not resolve animated values and the
 * markup is identical either way; the declaration is the only place the mistake
 * is visible.
 */
const stylesheet = readFileSync(
  fileURLToPath(new URL('../src/animations/score-count.css', import.meta.url)),
  'utf8',
)

function ruleBody(selector: string) {
  const start = stylesheet.indexOf(selector)
  expect(start, `${selector} is missing from score-count.css`).toBeGreaterThan(-1)
  const open = stylesheet.indexOf('{', start)
  const close = stylesheet.indexOf('}', open)
  return stylesheet.slice(open + 1, close)
}

describe('result score walk', () => {
  it('never animates filter on the cell', () => {
    expect(ruleBody('@keyframes score-cell-pop')).not.toContain('filter')
  })

  it('never sets filter on the counted cell either', () => {
    expect(ruleBody('.hidden-cell-score-counted {')).not.toContain('filter')
  })

  it('lifts the cell on a layer of its own instead', () => {
    // `opacity` is the property every compositor handles best, and unlike
    // `filter` it cannot collide with the cell's own ink chain.
    expect(ruleBody('@keyframes score-flash-pop')).toContain('opacity')
    expect(ruleBody('.score-count-flash {')).toContain('animation: score-flash-pop')
  })

  it('holds the walk and the lift on one clock', () => {
    // Two animations on two elements have to start together, or the scale pop
    // and the lift drift apart on the same cell.
    expect(ruleBody('.hidden-cell-score-counted {')).toContain(
      'animation-delay: var(--score-delay)',
    )
    expect(ruleBody('.score-count-flash {')).toContain('animation-delay: var(--score-delay)')
  })

  it('stands down for reduced motion', () => {
    const reduced = stylesheet.slice(stylesheet.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toContain('.score-count-flash')
    expect(reduced).toContain('animation: none')
  })
})
