import { clampGameConfig, DEFAULT_GAME_CONFIG, MIN_TURN_SECONDS, ONLINE_MIN_TURN_SECONDS, type GameConfig } from '@hidden/game-core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AdvancedSettings } from '../PregameUi'
import {
  ONLINE_RULE_SECTIONS,
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

  it('no longer offers a line length as a rule the player sets', () => {
    // It only ever set how long a line must be to unlock a power-up, never how
    // a match is won, so it rides the board size until unlocking is redesigned.
    expect(flatten(RULE_SECTIONS).map((field) => field.id)).not.toContain('streak')
  })

  it('takes the line length from the board on every size', () => {
    const field = flatten(RULE_SECTIONS).find((entry) => entry.id === 'boardSize')
    if (field?.kind !== 'choice') throw new Error('boardSize must be a choice field')

    for (const size of [3, 4, 5]) {
      expect(field.patch(size, DEFAULT_GAME_CONFIG)).toEqual({
        boardSize: size,
        streak: size,
      })
    }
  })

  it('shrinks an oversized line when the board shrinks under it', () => {
    const field = flatten(RULE_SECTIONS).find((entry) => entry.id === 'boardSize')
    if (field?.kind !== 'choice') throw new Error('boardSize must be a choice field')

    const patch = field.patch(3, { ...DEFAULT_GAME_CONFIG, boardSize: 5, streak: 5 })

    expect(patch).toEqual({ boardSize: 3, streak: 3 })
  })

  it('grows the line with the board rather than leaving a short one behind', () => {
    const field = flatten(RULE_SECTIONS).find((entry) => entry.id === 'boardSize')
    if (field?.kind !== 'choice') throw new Error('boardSize must be a choice field')

    const patch = field.patch(5, { ...DEFAULT_GAME_CONFIG, boardSize: 3, streak: 2 })

    expect(patch).toEqual({ boardSize: 5, streak: 5 })
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

  it('keeps the line length off the panel entirely', () => {
    const markup = render({ ...DEFAULT_GAME_CONFIG, boardSize: 3, streak: 3 })

    expect(markup).not.toContain('data-rule="streak"')
    expect(markup).not.toContain('Line to win')
  })

  it('hides nested power-up rules while their parent rule is off', () => {
    const off = render({ ...DEFAULT_GAME_CONFIG, powerupsEnabled: false })
    const on = render({ ...DEFAULT_GAME_CONFIG, powerupsEnabled: true })

    expect(off).not.toContain('data-rule="powerups.shield"')
    expect(on).toContain('data-rule="powerups.shield"')
  })

  it('reports each flag state to assistive tech, not by colour alone', () => {
    const markup = render({ ...DEFAULT_GAME_CONFIG, blindMode: true, powerupsEnabled: false })

    expect(tagWith(markup, 'button', 'data-rule="blindMode"')).toContain('aria-pressed="true"')
    expect(tagWith(markup, 'button', 'data-rule="powerupsEnabled"')).toContain(
      'aria-pressed="false"',
    )
  })

  it('offers sub-second turns offline but floors the online host panel', () => {
    const offline = RULE_SECTIONS.flatMap((section) => section.fields).find(
      (field) => field.id === 'turnSeconds',
    )
    const online = ONLINE_RULE_SECTIONS.flatMap((section) => section.fields).find(
      (field) => field.id === 'turnSeconds',
    )

    expect(offline).toMatchObject({ kind: 'number', min: MIN_TURN_SECONDS })
    expect(online).toMatchObject({ kind: 'number', min: ONLINE_MIN_TURN_SECONDS })
  })

  it('steps whole seconds down to one, then fifths into the sub-second range', () => {
    const field = RULE_SECTIONS.flatMap((section) => section.fields).find(
      (candidate) => candidate.id === 'turnSeconds',
    )
    if (field?.kind !== 'number' || !field.step) throw new Error('Expected a stepped number field.')

    // Whole seconds through the useful range, then fine enough to reach the floor.
    expect(field.step(10, -1)).toBe(9)
    expect(field.step(2, -1)).toBe(1)
    expect(field.step(1, -1)).toBe(0.8)
    expect(field.step(0.4, -1)).toBe(0.2)
    expect(field.step(0.8, 1)).toBe(1)
    expect(field.step(1, 1)).toBe(2)
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
