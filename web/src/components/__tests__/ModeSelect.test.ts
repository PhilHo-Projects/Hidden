import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModeSelect } from '../ModeSelect'
import {
  CUBE_VIEW_LABELS,
  PROTOTYPES_LABEL,
  PROTOTYPE_WARNING,
  VARIANT_LABELS,
} from '../../game/constants'
import type { CubeView } from '../../game/cubeView'
import type { GameVariant } from '@hidden/game-core'

function render(value: GameVariant, view: CubeView = 'flat') {
  return renderToStaticMarkup(
    createElement(ModeSelect, {
      value,
      view,
      onChange: () => undefined,
      onViewChange: () => undefined,
    }),
  )
}

function radio(markup: string, name: string, value: string) {
  const tags = markup.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, 'g')) ?? []
  return tags.find((tag) => tag.includes(`value="${value}"`)) ?? ''
}

describe('ModeSelect', () => {
  it('offers MAIN and one PROTOTYPES entry', () => {
    const markup = render('main')
    expect(radio(markup, 'mode-select', 'main')).not.toBe('')
    expect(radio(markup, 'mode-select', 'prototype')).not.toBe('')
    expect(markup).toContain(VARIANT_LABELS.main)
    expect(markup).toContain(PROTOTYPES_LABEL)
  })

  it('checks the selected variant and only that one', () => {
    const markup = render('prototype')
    expect(radio(markup, 'mode-select', 'prototype')).toContain('checked')
    expect(radio(markup, 'mode-select', 'main')).not.toContain('checked')
  })

  it('marks the prototypes as under development whichever mode is selected', () => {
    // The tag belongs to the option, not to the selection: a player has to be
    // able to see what they are about to choose.
    expect(render('main')).toContain('UNDER DEVELOPMENT')
    expect(render('prototype')).toContain('UNDER DEVELOPMENT')
  })

  it('warns only while the prototypes are selected', () => {
    expect(render('prototype')).toContain(PROTOTYPE_WARNING)
    expect(render('main')).not.toContain(PROTOTYPE_WARNING)
  })

  it('carries the hazard state on the control itself', () => {
    // Selecting the prototypes recolours the whole control rather than adding
    // a badge beside it, so the mode cannot be entered without noticing.
    expect(render('prototype')).toContain('mode-select-hazard')
    expect(render('main')).not.toContain('mode-select-hazard')
  })

  it('offers both cube views only under PROTOTYPES', () => {
    const prototype = render('prototype')
    expect(prototype).toContain(CUBE_VIEW_LABELS.flat)
    expect(prototype).toContain(CUBE_VIEW_LABELS['3d'])
    expect(prototype.match(/>WIP</g)).toHaveLength(2)

    const main = render('main')
    expect(main).not.toContain(CUBE_VIEW_LABELS.flat)
    expect(main).not.toContain(CUBE_VIEW_LABELS['3d'])
  })

  it('checks the remembered view', () => {
    const markup = render('prototype', '3d')
    expect(radio(markup, 'cube-view', '3d')).toContain('checked')
    expect(radio(markup, 'cube-view', 'flat')).not.toContain('checked')
  })

  it('keeps the radios reachable rather than removing them', () => {
    // Visually hidden, not display:none -- the label is the visible control but
    // the input is what a keyboard drives.
    const markup = render('prototype')
    expect(markup).not.toContain('display:none')
    expect(markup.match(/type="radio"/g)).toHaveLength(4)
  })
})
