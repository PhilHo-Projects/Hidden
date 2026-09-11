import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModeSelect } from '../ModeSelect'
import { PROTOTYPE_WARNING, VARIANT_LABELS } from '../../game/constants'
import type { GameVariant } from '@hidden/game-core'

function render(value: GameVariant) {
  return renderToStaticMarkup(
    createElement(ModeSelect, { value, onChange: () => undefined }),
  )
}

function radio(markup: string, variant: GameVariant) {
  const tags = markup.match(/<input[^>]*name="mode-select"[^>]*>/g) ?? []
  return tags.find((tag) => tag.includes(`value="${variant}"`)) ?? ''
}

describe('ModeSelect', () => {
  it('offers every variant', () => {
    const markup = render('main')
    expect(radio(markup, 'main')).not.toBe('')
    expect(radio(markup, 'prototype')).not.toBe('')
    expect(markup).toContain(VARIANT_LABELS.main)
    expect(markup).toContain(VARIANT_LABELS.prototype)
  })

  it('checks the selected variant and only that one', () => {
    const markup = render('prototype')
    expect(radio(markup, 'prototype')).toContain('checked')
    expect(radio(markup, 'main')).not.toContain('checked')
  })

  it('marks the prototype as under development whichever mode is selected', () => {
    // The tag belongs to the option, not to the selection: a player has to be
    // able to see what they are about to choose.
    expect(render('main')).toContain('UNDER DEVELOPMENT')
    expect(render('prototype')).toContain('UNDER DEVELOPMENT')
  })

  it('warns only while the prototype is the selected mode', () => {
    expect(render('prototype')).toContain(PROTOTYPE_WARNING)
    expect(render('main')).not.toContain(PROTOTYPE_WARNING)
  })

  it('carries the hazard state on the control itself', () => {
    // Selecting the prototype recolours the whole control rather than adding a
    // badge beside it, so the mode cannot be entered without noticing.
    expect(render('prototype')).toContain('mode-select-hazard')
    expect(render('main')).not.toContain('mode-select-hazard')
  })

  it('keeps the radios reachable rather than removing them', () => {
    // Visually hidden, not display:none -- the label is the visible control but
    // the input is what a keyboard drives.
    const markup = render('main')
    expect(markup).not.toContain('display:none')
    expect(markup).toContain('type="radio"')
  })
})
