import { clampGameConfig, DEFAULT_GAME_CONFIG, type GameConfig } from '@hidden/game-core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AdvancedSettings } from '../PregameUi'
import {
  RULE_SECTIONS,
  type FlagField,
  type RuleField,
  type RuleSection,
} from '../ruleSchema'

function flatten(sections: readonly RuleSection[]): RuleField[] {
  return sections.flatMap((section) =>
    section.fields.flatMap((field) =>
      field.kind === 'flag' && field.children
        ? [field as RuleField, ...(field.children as RuleField[])]
        : [field],
    ),
  )
}

/** The whole tag for one element, so assertions do not depend on attribute order. */
function tagWith(markup: string, element: string, attribute: string) {
  return markup.match(new RegExp(`<${element}[^>]*${attribute}[^>]*>`))?.[0] ?? ''
}

function radio(markup: string, ruleId: string, value: number) {
  const tags = markup.match(new RegExp(`<input[^>]*name="rule-${ruleId}"[^>]*>`, 'g')) ?? []
  return tags.find((tag) => tag.includes(`value="${value}"`)) ?? ''
}

function render(config: GameConfig, sections?: readonly RuleSection[]) {
  return renderToStaticMarkup(
    createElement(AdvancedSettings, {
      config,
      onConfigChange: () => undefined,
      ...(sections ? { sections } : {}),
    }),
  )
}

describe('advanced rules schema', () => {
  it('gives every field a unique id so a new rule cannot silently shadow another', () => {
    const ids = flatten(RULE_SECTIONS).map((field) => field.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps every field patch inside what the shared clamp accepts', () => {
    for (const field of flatten(RULE_SECTIONS)) {
      const patches =
        field.kind === 'flag'
          ? [field.patch(true, DEFAULT_GAME_CONFIG), field.patch(false, DEFAULT_GAME_CONFIG)]
          : field.kind === 'number'
            ? [
                field.patch(field.min, DEFAULT_GAME_CONFIG),
                field.patch(field.max, DEFAULT_GAME_CONFIG),
              ]
            : field
                .options(DEFAULT_GAME_CONFIG)
                .filter((option) => !option.disabled)
                .map((option) => field.patch(option.value, DEFAULT_GAME_CONFIG))

      for (const patch of patches) {
        const merged = { ...DEFAULT_GAME_CONFIG, ...patch }

        expect(clampGameConfig(merged), `${field.id} produced a config the clamp rewrote`).toEqual(
          merged,
        )
      }
    }
  })

  it('offers every line length the board can hold and disables the rest', () => {
    const field = flatten(RULE_SECTIONS).find((entry) => entry.id === 'streak')
    if (field?.kind !== 'choice') throw new Error('streak must be a choice field')

    const options = field.options({ ...DEFAULT_GAME_CONFIG, boardSize: 4 })

    expect(options.map((option) => option.value)).toEqual([2, 3, 4, 5])
    expect(options.filter((option) => option.disabled).map((option) => option.value)).toEqual([5])
  })

  it('shrinks an oversized line when the board shrinks under it', () => {
    const field = flatten(RULE_SECTIONS).find((entry) => entry.id === 'boardSize')
    if (field?.kind !== 'choice') throw new Error('boardSize must be a choice field')

    const patch = field.patch(3, { ...DEFAULT_GAME_CONFIG, boardSize: 5, streak: 5 })

    expect(patch).toEqual({ boardSize: 3, streak: 3 })
  })

  it('leaves a line that already fits alone when the board grows', () => {
    const field = flatten(RULE_SECTIONS).find((entry) => entry.id === 'boardSize')
    if (field?.kind !== 'choice') throw new Error('boardSize must be a choice field')

    const patch = field.patch(5, { ...DEFAULT_GAME_CONFIG, boardSize: 3, streak: 2 })

    expect(patch).toEqual({ boardSize: 5 })
  })
})

describe('advanced rules panel', () => {
  it('renders one labelled control for every field in the schema', () => {
    const markup = render({ ...DEFAULT_GAME_CONFIG, powerupsEnabled: true })

    for (const field of flatten(RULE_SECTIONS)) {
      expect(markup, `${field.id} is in the schema but not on screen`).toContain(
        `data-rule="${field.id}"`,
      )
      expect(markup).toContain(field.label)
    }
  })

  it('renders a board size as a radio group with the active size checked', () => {
    const markup = render({ ...DEFAULT_GAME_CONFIG, boardSize: 4 })

    expect(markup).toContain('role="radiogroup"')
    expect(radio(markup, 'boardSize', 4)).toContain('checked=""')
    expect(radio(markup, 'boardSize', 3)).not.toContain('checked=""')
  })

  it('disables the line lengths the current board cannot hold', () => {
    const markup = render({ ...DEFAULT_GAME_CONFIG, boardSize: 3, streak: 3 })

    expect(radio(markup, 'streak', 5)).toContain('disabled=""')
    expect(radio(markup, 'streak', 4)).toContain('disabled=""')
    expect(radio(markup, 'streak', 2)).not.toContain('disabled=""')
  })

  it('hides nested power-up rules while their parent rule is off', () => {
    const off = render({ ...DEFAULT_GAME_CONFIG, powerupsEnabled: false })
    const on = render({ ...DEFAULT_GAME_CONFIG, powerupsEnabled: true })

    expect(off).not.toContain('data-rule="powerups.shield"')
    expect(on).toContain('data-rule="powerups.shield"')
  })

  it('reports each flag state to assistive tech, not by colour alone', () => {
    const markup = render({ ...DEFAULT_GAME_CONFIG, blindMode: true, forbidImmediateRepeat: false })

    expect(tagWith(markup, 'button', 'data-rule="blindMode"')).toContain('aria-pressed="true"')
    expect(tagWith(markup, 'button', 'data-rule="forbidImmediateRepeat"')).toContain(
      'aria-pressed="false"',
    )
  })

  it('uses one control vocabulary, with no sliding switches left behind', () => {
    const markup = render(DEFAULT_GAME_CONFIG)

    expect(markup).not.toContain('hidden-toggle')
  })

  it('renders a rule the caller adds without touching the panel', () => {
    const extra: FlagField = {
      kind: 'flag',
      id: 'suddenDeath',
      label: 'Sudden death',
      value: () => true,
      patch: () => ({}),
    }
    const sections: RuleSection[] = [
      ...RULE_SECTIONS,
      { id: 'experimental', label: 'Experimental', layout: 'flags', fields: [extra] },
    ]

    const markup = render(DEFAULT_GAME_CONFIG, sections)

    expect(markup).toContain('data-rule="suddenDeath"')
    expect(markup).toContain('Sudden death')
    expect(markup).toContain('Experimental')
  })
})
