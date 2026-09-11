# Cube Prototype Mode — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a second game variant selectable and playable end-to-end, so that every seam it has to pass through — config, wire, matchmaking, lobby, offline, result screen, history, UI labelling — is working before any cube geometry exists.

**Architecture:** `GameConfig` gains a `variant: 'main' | 'prototype'` discriminant. `prototype` plays identically to `main` in this phase: same 3x3 board, same rules, 12 rounds instead of 6. What differs is that it is labelled UNDER DEVELOPMENT everywhere, declares no winner, is queued separately in matchmaking, and is never written to match history. The config already travels with the match, so no packet IDs change and no new packets are added.

**Tech Stack:** TypeScript, React 19, Vite 8, Express 5, `ws` 8, MessagePack 3, Vitest, Node 24.

**Spec:** [`docs/superpowers/specs/2026-09-11-cube-prototype-mode-design.md`](../specs/2026-09-11-cube-prototype-mode-design.md)

## Global Constraints

- Node 24.
- **`ENGINE_REVISION` stays at 2.** Nothing in this phase changes placement resolution, scoring, or the RNG for a `main` match. If you find yourself wanting to bump it, stop and re-read the spec's "Engine revision: no bump" section.
- **Preserve numeric packet IDs.** This phase adds no packets and changes no packet numbers. `variant` rides inside the existing `GameConfig` payload.
- Tests come before runtime changes (`CLAUDE.md`, "Change discipline").
- `main` and `prototype` are placeholder names. Do not invent nicer ones.
- Verification per package: `npm test`, `npm run lint`, `npm run build` in `web/`; `npm test` and `npm run build` in `server/`.
- Do not log or commit email addresses, passwords, cookies, tokens, or complete auth URLs.
- Production stays one replica with process-local match state. Nothing here changes that.
- Do not add automated deployment workflows.

## Before you start

You are on `main`, and other sessions land PRs on `main` mid-task. Create a branch first:

```bash
git switch -c cube-prototype-phase-0
```

The spec and roadmap changes are already in the working tree, uncommitted. Commit them as the first thing on the branch:

```bash
git add docs/ROADMAP.md docs/superpowers/specs/2026-09-11-cube-prototype-mode-design.md docs/superpowers/plans/2026-09-11-cube-prototype-phase-0.md
git commit -m "docs: spec the cube prototype mode and its phase 0 plan

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

## File Structure

**Created:**
- `web/src/components/ModeSelect.tsx` — the variant picker. One component used on both entry screens; it owns the UNDER DEVELOPMENT labelling so the warning cannot appear on one screen and not the other.
- `web/src/prototype-mode.css` — all chrome specific to the prototype variant. A separate file rather than more of `index.css` (already 4433 lines and listed as roadmap debt) so that when this mode graduates or dies, the styling is a file deletion rather than an archaeology exercise. `BoardGrid.tsx` already establishes the precedent of a component importing its own CSS.
- `web/src/components/__tests__/ModeSelect.test.ts`

**Modified:**
- `packages/game-core/src/index.ts` — `GameVariant`, `GameConfig.variant`, clamp, `defaultConfigForVariant`.
- `packages/game-core/src/index.test.ts`
- `server/src/matchRules.ts` — re-export the new config surface.
- `server/src/matchCoordinator.ts` — queue segregation, history gate.
- `server/src/matchCoordinator.test.ts`
- `web/src/components/ruleSchema.ts` — board size constrained under `prototype`.
- `web/src/components/__tests__/AdvancedSettings.test.ts`
- `web/src/components/PregameUi.tsx` — `MatchRulesSummary` shows the variant.
- `web/src/game/viewModel.ts` — pure helpers for the quick-match config decision and the result headline, so `App.tsx` stays branch-light and the logic is testable.
- `web/src/game/__tests__/viewModel.test.ts`
- `web/src/App.tsx` — wire the selector in, banner, TBD result.

---

### Task 1: `variant` in `GameConfig`

The discriminant every later task keys off. Everything else in this plan depends on this task.

**Files:**
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `export type GameVariant = 'main' | 'prototype'`
  - `GameConfig.variant: GameVariant`
  - `export const PROTOTYPE_BOARD_SIZE: 3`
  - `export const PROTOTYPE_ROUNDS: 12`
  - `export function defaultConfigForVariant(variant: GameVariant): GameConfig`

> **Test dialect:** this package alone runs on `node:test` with
> `node:assert/strict` (`node --no-warnings --test src/index.test.ts`), and
> imports from `./index.ts` with the extension. `server/` and `web/` use Vitest;
> do not carry `expect(...)` into this file.

- [ ] **Step 1: Write the failing tests**

Append to `packages/game-core/src/index.test.ts`, and add `defaultConfigForVariant` to its existing import block:

```ts
describe('game variant', () => {
  it('defaults to main when the field is absent', () => {
    assert.equal(clampGameConfig({}).variant, 'main')
    assert.equal(DEFAULT_GAME_CONFIG.variant, 'main')
  })

  it('falls back to main for an unrecognised variant', () => {
    assert.equal(clampGameConfig({ variant: 'cube' }).variant, 'main')
    assert.equal(clampGameConfig({ variant: 7 }).variant, 'main')
    assert.equal(clampGameConfig({ variant: null }).variant, 'main')
  })

  it('keeps a recognised variant', () => {
    assert.equal(clampGameConfig({ variant: 'prototype' }).variant, 'prototype')
  })

  it('forces a 3x3 board under prototype, whatever was asked for', () => {
    const config = clampGameConfig({ variant: 'prototype', boardSize: 5, streak: 5 })
    assert.equal(config.boardSize, 3, 'the cube is six 3x3 faces')
    assert.equal(config.streak, 3, 'the streak rides the board size')
  })

  it('leaves board size alone under main', () => {
    const config = clampGameConfig({ variant: 'main', boardSize: 5, streak: 5 })
    assert.equal(config.boardSize, 5)
  })

  it('gives each variant its own starting config', () => {
    assert.deepEqual(defaultConfigForVariant('main'), DEFAULT_GAME_CONFIG)

    const prototype = defaultConfigForVariant('prototype')
    assert.equal(prototype.variant, 'prototype')
    assert.equal(prototype.boardSize, 3)
    assert.equal(
      prototype.rounds,
      DEFAULT_GAME_CONFIG.rounds * 2,
      'double the main default, because a cube has more board to cover',
    )
  })

  it('produces a config the clamp accepts unchanged', () => {
    for (const variant of ['main', 'prototype'] as const) {
      const config = defaultConfigForVariant(variant)
      assert.deepEqual(
        clampGameConfig(config),
        config,
        `${variant} round-trips through the clamp`,
      )
    }
  })

  it('does not change how a main match resolves', () => {
    // The whole "no ENGINE_REVISION bump" argument rests on this.
    assert.equal(
      ENGINE_REVISION,
      2,
      'a cube topology is a config change, not an engine change',
    )
    const state = createGame(baseSpec({ config: clampGameConfig({ variant: 'main' }) }))
    assert.deepEqual(state.mode.topology.locationIds, [0, 1, 2, 3, 4, 5, 6, 7, 8])
    assert.equal(state.mode.topology.winningPatterns.length, 8)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test --workspace=@hidden/game-core
```

Expected: FAIL — `defaultConfigForVariant is not a function`, and the variant assertions fail because the field does not exist.

- [ ] **Step 3: Add the type, the constants, and the config field**

In `packages/game-core/src/index.ts`, next to the existing `BoardSize` declaration:

```ts
/**
 * Which game this config describes. `main` is the shipped 3x3 game; `prototype`
 * is the cube experiment, which is deliberately incomplete and declares no
 * winner. Both names are placeholders.
 *
 * A union rather than a subclass hierarchy on purpose: `GameState` crosses
 * MessagePack and is cloned on every command, so behaviour has to be a pure
 * function of data. The compiler's exhaustiveness check on a `switch` is also
 * what stops a new variant from silently inheriting `main`'s behaviour.
 */
export type GameVariant = 'main' | 'prototype'

const GAME_VARIANTS: readonly GameVariant[] = ['main', 'prototype']

/** The cube is six 3x3 faces, so a prototype face is never any other size. */
export const PROTOTYPE_BOARD_SIZE = 3 as const

/** Double `main`'s default, because a cube match has more board to cover. */
export const PROTOTYPE_ROUNDS = 12 as const
```

Add the field to `GameConfig`, as the first member so it reads as the discriminant it is:

```ts
export interface GameConfig {
  readonly variant: GameVariant
  readonly boardSize: BoardSize
  // ...the rest unchanged
}
```

Add it to `DEFAULT_GAME_CONFIG`:

```ts
export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = deepFreeze({
  variant: 'main',
  boardSize: 3,
  // ...the rest unchanged
}) as Readonly<GameConfig>
```

- [ ] **Step 4: Teach the clamp about the variant**

Inside `clampGameConfig`, before the existing `requestedSize` block:

```ts
  const variant: GameVariant = GAME_VARIANTS.includes(
    candidate.variant as GameVariant,
  )
    ? (candidate.variant as GameVariant)
    : DEFAULT_GAME_CONFIG.variant
```

Replace the existing `boardSize` resolution with a variant-aware one:

```ts
  const requestedSize = clampInteger(
    candidate.boardSize,
    3,
    5,
    DEFAULT_GAME_CONFIG.boardSize,
  )
  // A prototype face is always 3x3. This is a constraint, not a default: a host
  // who asks for 5x5 in this variant is asking for something that does not
  // exist, so it is corrected rather than honoured.
  const boardSize = (
    variant === 'prototype'
      ? PROTOTYPE_BOARD_SIZE
      : BOARD_SIZES.includes(requestedSize as BoardSize)
        ? requestedSize
        : DEFAULT_GAME_CONFIG.boardSize
  ) as BoardSize
```

Add `variant` to the returned object, first, matching the interface order:

```ts
  return {
    variant,
    boardSize,
    // ...the rest unchanged
  }
```

`streak` already clamps to `boardSize`, so forcing the board to 3 forces the streak with it. No change needed there.

- [ ] **Step 5: Add `defaultConfigForVariant`**

Immediately after `clampGameConfig`:

```ts
/**
 * The starting rules for a variant, used when the player switches modes.
 *
 * Separate from `clampGameConfig` deliberately. The clamp is tolerant and
 * cannot tell "the host chose 6 rounds" from "rounds were missing", so making
 * it apply per-variant defaults would let it silently overwrite a deliberate
 * choice. Defaults belong to the moment a mode is picked; the clamp only ever
 * validates.
 */
export function defaultConfigForVariant(variant: GameVariant): GameConfig {
  switch (variant) {
    case 'main':
      return DEFAULT_GAME_CONFIG
    case 'prototype':
      return clampGameConfig({
        ...DEFAULT_GAME_CONFIG,
        variant,
        boardSize: PROTOTYPE_BOARD_SIZE,
        streak: PROTOTYPE_BOARD_SIZE,
        rounds: PROTOTYPE_ROUNDS,
      })
  }
}
```

The `switch` with a return in every arm and no `default` is what gives the exhaustiveness check: adding a third variant later will fail to compile here until it is handled.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm test --workspace=@hidden/game-core
```

Expected: PASS, including every pre-existing test.

One pre-existing test fails first: *"defaults to the game as it plays today"* spells out the whole default config as a literal. Add `variant: 'main'` to it — the field genuinely is part of the config now.

- [ ] **Step 6a: Fix the downstream config literals**

`variant` is required, so every `GameConfig` object literal in the repo stops compiling. Runtime code all goes through `clampGameConfig`, so only test fixtures are affected — three of them, all in `server/`, all needing `variant: 'main'` added as the first field:

- `server/src/matchHistory/repository.integration.test.ts` (~line 29)
- `server/src/admin/repository.integration.test.ts` (~line 28)
- `server/src/matchHistory/recorder.test.ts` (~line 11)

They surface through `npm test --workspace=hidden-server`, not through `npm run build` — the build uses `tsconfig.json`, which excludes tests; the test script typechecks `tsconfig.test.json` first.

> **Environment note:** if `better-auth` modules cannot be resolved, dependencies are not installed — run `npm install` at the repo root. And `npm run build --workspace=hidden-web` requires `VITE_TURNSTILE_SITE_KEY` for production builds only; pass Cloudflare's documented always-passes test key inline for local verification:
> ```bash
> VITE_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build --workspace=hidden-web
> ```

- [ ] **Step 7: Build the package**

```bash
npm run build --workspace=@hidden/game-core
```

Expected: clean. `web/` and `server/` both build `game-core` in their `pretest`, but building it now means the next tasks see the new types immediately.

- [ ] **Step 8: Commit**

```bash
git add packages/game-core/src/index.ts packages/game-core/src/index.test.ts
git commit -m "feat(core): add a game variant discriminant to GameConfig

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Matchmaking segregates on variant

Quick Match currently pairs any two waiting players and then resolves the rules as `first.proposedConfig ?? second.proposedConfig`, so one player's rules silently win. That is already a latent bug for board size; with a variant it means queueing for `prototype` and landing in `main`.

**Files:**
- Modify: `server/src/matchCoordinator.ts` (imports; `enqueueQuickMatch`, around line 287)
- Test: `server/src/matchCoordinator.test.ts`

**Interfaces:**
- Consumes: `GameVariant`, `DEFAULT_GAME_CONFIG` from Task 1.
- Produces: no new exports. `enqueueQuickMatch` keeps its signature and returns `undefined` where it previously returned a room, when the only available partner wants a different variant.

- [ ] **Step 1: Write the failing tests**

Append to `server/src/matchCoordinator.test.ts`:

```ts
describe('quick match variant segregation', () => {
  const prototypeConfig: GameConfig = {
    ...DEFAULT_GAME_CONFIG,
    variant: 'prototype',
  }

  it('does not pair players who asked for different variants', () => {
    const { dependencies } = deterministicDependencies()
    const coordinator = new MatchCoordinator(dependencies)

    expect(coordinator.enqueueQuickMatch(firstParticipant)).toBeUndefined()
    expect(
      coordinator.enqueueQuickMatch(secondParticipant, prototypeConfig),
    ).toBeUndefined()
    expect(coordinator.getRuntimeStats().queuedPlayers).toBe(2)
  })

  it('pairs two players who asked for the same variant', () => {
    const { dependencies } = deterministicDependencies()
    const coordinator = new MatchCoordinator(dependencies)

    expect(
      coordinator.enqueueQuickMatch(firstParticipant, prototypeConfig),
    ).toBeUndefined()
    const room = coordinator.enqueueQuickMatch(secondParticipant, prototypeConfig)

    expect(room).toBeDefined()
    expect(room?.config.variant).toBe('prototype')
  })

  it('treats a player who proposed no config as wanting main', () => {
    const { dependencies } = deterministicDependencies()
    const coordinator = new MatchCoordinator(dependencies)

    coordinator.enqueueQuickMatch(firstParticipant, prototypeConfig)
    expect(coordinator.enqueueQuickMatch(secondParticipant)).toBeUndefined()

    const third = { connectionId: 33, username: 'Guest#0033' }
    const room = coordinator.enqueueQuickMatch(third)
    expect(room?.config.variant).toBe('main')
  })

  it('pairs a later compatible arrival past an incompatible one', () => {
    const { dependencies } = deterministicDependencies()
    const coordinator = new MatchCoordinator(dependencies)

    coordinator.enqueueQuickMatch(firstParticipant, prototypeConfig)
    coordinator.enqueueQuickMatch(secondParticipant)

    const third = { connectionId: 33, username: 'Guest#0033' }
    const room = coordinator.enqueueQuickMatch(third, prototypeConfig)

    expect(room).toBeDefined()
    expect(room?.config.variant).toBe('prototype')
    const ids = room?.participants.map((participant) => participant.connectionId)
    expect(ids).toContain(firstParticipant.connectionId)
    expect(ids).toContain(33)
    expect(coordinator.getRuntimeStats().queuedPlayers).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test --workspace=hidden-server -- matchCoordinator
```

Expected: FAIL — the first test pairs the two players and returns a room instead of `undefined`.

- [ ] **Step 3: Implement segregation**

In `server/src/matchCoordinator.ts`, add `type GameVariant` to the existing `@hidden/game-core` import block.

Add a helper beside the other module-level functions, near `freezeConfig`:

```ts
/**
 * A queued player with no proposed config is a non-admin quick-matcher, who
 * gets the server's defaults. That is `main`, so they queue as `main`.
 */
function entryVariant(entry: QuickMatchEntry): GameVariant {
  return entry.proposedConfig?.variant ?? DEFAULT_GAME_CONFIG.variant
}
```

In `enqueueQuickMatch`, extend the partner search. The existing `.find(...)` becomes:

```ts
      const second = entries
        .slice(firstIndex + 1)
        .find(
          (candidate) =>
            !isSameAuthenticatedAccount(
              first.participant,
              candidate.participant,
            ) &&
            // Two variants are two different games. Pairing across them would
            // hand one player the other's rules, which the `first ?? second`
            // resolution below would then do silently.
            entryVariant(first) === entryVariant(candidate),
        )
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test --workspace=hidden-server -- matchCoordinator
```

Expected: PASS, including every pre-existing matchmaking test.

- [ ] **Step 5: Commit**

```bash
git add server/src/matchCoordinator.ts server/src/matchCoordinator.test.ts
git commit -m "fix(server): queue quick match separately per game variant

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Prototype matches are not written to history

The v1 history record is the research notebook for `main`. It stores `columns: config.boardSize` next to a flat cell list, which a 54-cell cube board would misreport, and a mode with no win condition has no result worth keeping.

**Files:**
- Modify: `server/src/matchCoordinator.ts` (`finishRun`, around line 963)
- Test: `server/src/matchCoordinator.test.ts`

**Interfaces:**
- Consumes: `GameConfig.variant` from Task 1.
- Produces: no new exports. `onMatchCompleted` is no longer called for a non-`main` variant.

- [ ] **Step 1: Teach the test fixture about the variant**

`authoritativeFixture` (around line 322) enqueues the *second* player with no
proposed config. After Task 2 that means they queue as `main`, so a prototype
fixture has to propose the variant on **both** enqueues or the two will never
pair and `room` will be `undefined`.

Add `variant` to the options type:

```ts
    onMatchCompleted?: (record: unknown) => void
    rounds?: number
    turnSeconds?: number
    uuids?: string[]
    variant?: GameVariant
```

and thread it through both enqueues:

```ts
  coordinator.enqueueQuickMatch(firstParticipant, {
    rounds: options.rounds ?? 20,
    turnSeconds: options.turnSeconds ?? 10,
    blindMode: false,
    ...(options.variant ? { variant: options.variant } : {}),
  })
  // Both seats must propose the same variant or the queue will not pair them.
  const room = coordinator.enqueueQuickMatch(
    secondParticipant,
    options.variant ? { variant: options.variant } : undefined,
  )!
```

Add `type GameVariant` to the test file's `@hidden/game-core` import.

- [ ] **Step 2: Write the failing test**

Append to the existing `describe('MatchCoordinator finish, rematch, and legacy lifecycle', ...)` block, directly after the test named *"emits one immutable final snapshot when an online run completes"* — it is the positive case this one mirrors:

```ts
  it('records nothing when a prototype run completes', () => {
    const completed: unknown[] = []
    const fixture = authoritativeFixture({
      firstSeat: 0,
      now: 8_000,
      onMatchCompleted: (record) => completed.push(record),
      rounds: 1,
      uuids: ['stable-room', 'finished-run'],
      variant: 'prototype',
    })

    fixture.issue(0, { type: 'place', locationId: 0, symbol: 'rock' })
    fixture.issue(1, { type: 'place', locationId: 1, symbol: 'paper' })

    // The run still finishes and still scores; it is simply never written.
    // History is the research notebook for `main`, and this mode has no result
    // worth notebooking.
    expect(completed).toEqual([])
  })
```

The neighbouring test already asserts the `main` path records exactly one
snapshot, so the positive case needs nothing new. That test spreads
`DEFAULT_GAME_CONFIG` into its expected config, so it picks up `variant: 'main'`
from Task 1 without an edit.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
npm test --workspace=hidden-server -- matchCoordinator
```

Expected: FAIL — `completed` holds one record instead of being empty.

- [ ] **Step 4: Gate the recorder**

In `finishRun`:

```ts
  private finishRun(room: MatchRoom, run: MatchRun) {
    if (run.phase === 'finished') return
    this.clearRoomTimer(room)
    run.phase = 'finished'
    room.phase = 'finished'
    /*
     * Only `main` is recorded. The v1 record is the research notebook for the
     * shipped game: it stores a board as `columns` plus a flat cell list, which
     * a cube would misreport, and a variant with no win condition has no result
     * worth keeping. Written as "not main" rather than "is prototype" so a
     * future variant is excluded until someone decides otherwise.
     */
    if (run.state.config.variant !== 'main') return
    this.dependencies.onMatchCompleted?.(
      createMatchHistoryRecord({
        matchId: run.id,
        completedAtMs: this.dependencies.now(),
        participants: room.participants,
        state: run.state,
      }),
    )
  }
```

- [ ] **Step 5: Run the full server suite**

```bash
npm test --workspace=hidden-server
```

Expected: PASS. Run the whole suite here, not just `matchCoordinator`: `app.test.ts` also exercises completed matches.

- [ ] **Step 6: Commit**

```bash
git add server/src/matchCoordinator.ts server/src/matchCoordinator.test.ts
git commit -m "feat(server): keep prototype matches out of match history

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: The `ModeSelect` component

One component for both entry screens, owning the UNDER DEVELOPMENT labelling so the warning cannot appear on one screen and not the other.

**Files:**
- Create: `web/src/components/ModeSelect.tsx`
- Create: `web/src/prototype-mode.css`
- Test: `web/src/components/__tests__/ModeSelect.test.ts`

**Interfaces:**
- Consumes: `GameVariant` from Task 1.
- Produces:
  - `export const VARIANT_LABELS: Readonly<Record<GameVariant, string>>` — `{ main: 'MAIN', prototype: 'PROTOTYPE' }`
  - `export const PROTOTYPE_WARNING: string`
  - `export function ModeSelect(props: { value: GameVariant; onChange: (variant: GameVariant) => void })`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/__tests__/ModeSelect.test.ts`:

```ts
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ModeSelect, PROTOTYPE_WARNING, VARIANT_LABELS } from '../ModeSelect'
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
    expect(render('main')).toContain('UNDER DEVELOPMENT')
    expect(render('prototype')).toContain('UNDER DEVELOPMENT')
  })

  it('warns only while the prototype is the selected mode', () => {
    expect(render('prototype')).toContain(PROTOTYPE_WARNING)
    expect(render('main')).not.toContain(PROTOTYPE_WARNING)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace=hidden-web -- ModeSelect
```

Expected: FAIL — cannot resolve `../ModeSelect`.

- [ ] **Step 3: Write the component**

Create `web/src/components/ModeSelect.tsx`:

```tsx
import '../prototype-mode.css'
import type { GameVariant } from '@hidden/game-core'

/** Placeholders. Neither mode has earned a real name yet. */
export const VARIANT_LABELS: Readonly<Record<GameVariant, string>> = {
  main: 'MAIN',
  prototype: 'PROTOTYPE',
}

const VARIANT_DESCRIPTIONS: Readonly<Record<GameVariant, string>> = {
  main: 'The 3x3 game.',
  prototype: 'The cube experiment.',
}

export const PROTOTYPE_WARNING =
  'Incomplete. Expect bugs, and no winner is declared at the end.'

const VARIANTS: readonly GameVariant[] = ['main', 'prototype']

interface ModeSelectProps {
  value: GameVariant
  onChange: (variant: GameVariant) => void
}

/**
 * Switching modes replaces the whole config rather than patching one field —
 * see `defaultConfigForVariant`. A 5x5 board tuned for `main` is not a thing
 * `prototype` can honour, so carrying settings across would only produce a
 * config the clamp silently rewrites.
 */
export function ModeSelect({ value, onChange }: ModeSelectProps) {
  return (
    <section className="mode-select" aria-label="Game mode">
      <div className="mode-select-options">
        {VARIANTS.map((variant) => (
          <label
            key={variant}
            className={`mode-select-option ${
              value === variant ? 'mode-select-option-active' : ''
            }`}
          >
            <input
              type="radio"
              name="mode-select"
              value={variant}
              checked={value === variant}
              onChange={() => onChange(variant)}
            />
            <span className="mode-select-label">{VARIANT_LABELS[variant]}</span>
            <span className="mode-select-description">
              {VARIANT_DESCRIPTIONS[variant]}
            </span>
            {variant === 'prototype' ? (
              <span className="mode-select-flag">UNDER DEVELOPMENT</span>
            ) : null}
          </label>
        ))}
      </div>
      {value === 'prototype' ? (
        <p className="mode-select-warning" role="note">
          {PROTOTYPE_WARNING}
        </p>
      ) : null}
    </section>
  )
}
```

- [ ] **Step 4: Write the stylesheet**

Create `web/src/prototype-mode.css`. Everything specific to this variant's chrome lives here so it can be deleted in one move later.

Read `web/src/index.css` around `.action-choice` (line ~1973) and `.rule-chips` first and reuse the existing custom properties and brush/ink vocabulary rather than inventing new colours. The selected option should read as selected without relying on colour alone. Required classes:

- `.mode-select`, `.mode-select-options`, `.mode-select-option`, `.mode-select-option-active`
- `.mode-select-label`, `.mode-select-description`
- `.mode-select-flag` — the UNDER DEVELOPMENT tag; must read as a warning, not as decoration
- `.mode-select-warning`
- `.match-rules-variant` — the listing badge (used in Task 7)
- `.prototype-banner` (used in Task 8)
- `.results-tbd`, `.results-note`, `.results-debug` (used in Task 8)

Visually hide the radio input itself (clip, not `display:none`, so it stays focusable and reachable by keyboard) and style the label.

> **This is the one genuinely new visual surface in Phase 0. Load the `frontend-design` skill before writing this file.**

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test --workspace=hidden-web -- ModeSelect
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/ModeSelect.tsx web/src/prototype-mode.css web/src/components/__tests__/ModeSelect.test.ts
git commit -m "feat(web): add the game mode selector

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Board size is fixed under `prototype`

`clampGameConfig` already corrects an out-of-range board size, but the Advanced panel would still offer 4x4 and 5x5 and then appear to ignore the click. `ChoiceOption.disabled` exists exactly for this: "Rendered, but not selectable: the constraint stays visible."

**Files:**
- Modify: `web/src/components/ruleSchema.ts` (the `boardSize` field, around line 72)
- Test: `web/src/components/__tests__/AdvancedSettings.test.ts`

**Interfaces:**
- Consumes: `GameConfig.variant` from Task 1.
- Produces: no new exports. `boardSize.options(config)` now returns disabled entries for 4 and 5 when `config.variant === 'prototype'`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/__tests__/AdvancedSettings.test.ts`:

```ts
describe('board size under the prototype variant', () => {
  const boardSizeField = flatten(RULE_SECTIONS).find(
    (field) => field.id === 'boardSize',
  )

  it('offers every size under main', () => {
    if (boardSizeField?.kind !== 'choice') throw new Error('Expected a choice field.')
    const options = boardSizeField.options(DEFAULT_GAME_CONFIG)
    expect(options.every((option) => !option.disabled)).toBe(true)
  })

  it('leaves only 3x3 selectable under prototype', () => {
    if (boardSizeField?.kind !== 'choice') throw new Error('Expected a choice field.')
    const config = clampGameConfig({ ...DEFAULT_GAME_CONFIG, variant: 'prototype' })
    const options = boardSizeField.options(config)

    expect(options.find((option) => option.value === 3)?.disabled).toBeFalsy()
    expect(options.find((option) => option.value === 4)?.disabled).toBe(true)
    expect(options.find((option) => option.value === 5)?.disabled).toBe(true)
    // Still rendered, not removed: the constraint stays visible.
    expect(options).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace=hidden-web -- AdvancedSettings
```

Expected: FAIL — `disabled` is `undefined` for 4 and 5.

- [ ] **Step 3: Constrain the options**

In `web/src/components/ruleSchema.ts`, replace the `boardSize` field's `options`:

```ts
const boardSize: ChoiceField = {
  kind: 'choice',
  id: 'boardSize',
  label: 'Board',
  // The cube is six 3x3 faces, so the prototype has no other size to offer.
  // Disabled rather than removed, so the rule is visible instead of implied.
  options: (config) =>
    BOARD_SIZES.map((size) => ({
      value: size,
      label: `${size} × ${size}`,
      ...(config.variant === 'prototype' && size !== PROTOTYPE_BOARD_SIZE
        ? { disabled: true }
        : {}),
    })),
  value: (config) => config.boardSize,
  // The line length is no longer a rule the player sets, so it rides the board:
  // a full row, column, or diagonal, whatever the board size.
  patch: (value) => ({ boardSize: value as BoardSize, streak: value }),
}
```

Add `PROTOTYPE_BOARD_SIZE` to the existing `@hidden/game-core` import at the top of the file.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace=hidden-web -- AdvancedSettings
```

Expected: PASS, including the pre-existing round-trip tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ruleSchema.ts web/src/components/__tests__/AdvancedSettings.test.ts
git commit -m "feat(web): fix the board at 3x3 under the prototype variant

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: View-model helpers for the variant

Two decisions that `App.tsx` would otherwise make inline, pulled into `viewModel.ts` where the existing display helpers live and where they can be tested.

The Quick Match one matters: today Quick Match sends `config` only for admins, because a stranger should not be bound by rules they did not choose. But the variant is not a rule, it is *which queue you join* — so it has to travel for everyone, while the rest of the config stays admin-only.

**Files:**
- Modify: `web/src/game/viewModel.ts`
- Test: `web/src/game/__tests__/viewModel.test.ts`

**Interfaces:**
- Consumes: `defaultConfigForVariant`, `GameConfig` from Task 1.
- Produces:
  - `export function quickMatchConfig(config: GameConfig, isAdmin: boolean): GameConfig`
  - `export function isPrototypeMatch(match: GameState | null): boolean`
  - `export function getResultHeadline(match: GameState): string`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/game/__tests__/viewModel.test.ts`:

```ts
describe('quickMatchConfig', () => {
  it('sends an admin their full config', () => {
    const config = clampGameConfig({ ...DEFAULT_GAME_CONFIG, boardSize: 5, streak: 5 })
    expect(quickMatchConfig(config, true)).toEqual(config)
  })

  it('sends a non-admin only their variant, on default rules', () => {
    const config = clampGameConfig({
      ...DEFAULT_GAME_CONFIG,
      variant: 'prototype',
      turnSeconds: 45,
    })
    const sent = quickMatchConfig(config, false)

    expect(sent.variant).toBe('prototype')
    // The variant decides which queue you join, so it travels. The rest would
    // bind a stranger to rules they never saw, so it does not.
    expect(sent.turnSeconds).toBe(DEFAULT_GAME_CONFIG.turnSeconds)
    expect(sent).toEqual(defaultConfigForVariant('prototype'))
  })

  it('is the plain default for a non-admin on main', () => {
    expect(quickMatchConfig(DEFAULT_GAME_CONFIG, false)).toEqual(DEFAULT_GAME_CONFIG)
  })
})

describe('prototype result presentation', () => {
  const matchWith = (variant: 'main' | 'prototype', outcome: 'win' | 'loss' | 'tie') =>
    ({
      config: { ...defaultConfigForVariant(variant), isOnline: false, hasAI: true },
      result: { playerScore: 5, opponentScore: 4, outcome },
    }) as unknown as GameState

  it('declares an outcome for main', () => {
    expect(getResultHeadline(matchWith('main', 'win'))).toBe('YOU WIN!')
    expect(getResultHeadline(matchWith('main', 'loss'))).toBe('YOU LOSE!')
    expect(getResultHeadline(matchWith('main', 'tie'))).toBe("IT'S A TIE!")
  })

  it('declares nothing for the prototype, whatever the scores say', () => {
    expect(getResultHeadline(matchWith('prototype', 'win'))).toBe('TBD')
    expect(getResultHeadline(matchWith('prototype', 'loss'))).toBe('TBD')
  })

  it('identifies a prototype match', () => {
    expect(isPrototypeMatch(matchWith('prototype', 'win'))).toBe(true)
    expect(isPrototypeMatch(matchWith('main', 'win'))).toBe(false)
    expect(isPrototypeMatch(null)).toBe(false)
  })
})
```

Add the needed imports to the top of the test file: `clampGameConfig`, `DEFAULT_GAME_CONFIG`, `defaultConfigForVariant` from `@hidden/game-core`; `quickMatchConfig`, `isPrototypeMatch`, `getResultHeadline` from `../viewModel`; and `type GameState` from `../types` if it is not already imported there.

The `matchWith` helper casts through `unknown` because only two fields of `GameState` matter here. That is deliberate — a full fixture would couple this test to every unrelated field the match state grows later.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test --workspace=hidden-web -- viewModel
```

Expected: FAIL — none of the three functions exist.

- [ ] **Step 3: Write the helpers**

Append to `web/src/game/viewModel.ts`:

```ts
/**
 * What Quick Match proposes to the server.
 *
 * The rules stay admin-only, because Quick Match binds a stranger to whatever
 * the proposer asked for. The variant is exempt: it is not a rule, it is which
 * queue you are standing in, and a player who picked the prototype and landed
 * in a main match would have no way to tell what went wrong.
 */
export function quickMatchConfig(config: GameConfig, isAdmin: boolean): GameConfig {
  return isAdmin ? config : defaultConfigForVariant(config.variant)
}

export function isPrototypeMatch(match: GameState | null) {
  return match?.config.variant === 'prototype'
}

/**
 * The result headline. The prototype has no win condition, so it reports none —
 * the engine still counts cells, and that count is shown as debug output, but
 * calling one player the winner of a game whose rules are undecided would be a
 * claim the mode cannot back.
 */
export function getResultHeadline(match: GameState) {
  if (isPrototypeMatch(match)) return 'TBD'
  if (!match.result) return 'GAME OVER'
  if (match.result.outcome === 'win') return 'YOU WIN!'
  if (match.result.outcome === 'loss') return 'YOU LOSE!'
  return "IT'S A TIE!"
}
```

Add `defaultConfigForVariant` and `type GameConfig` to the file's imports from `@hidden/game-core`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test --workspace=hidden-web -- viewModel
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/game/viewModel.ts web/src/game/__tests__/viewModel.test.ts
git commit -m "feat(web): add view-model helpers for the game variant

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Show the variant in the rules summary

`MatchRulesSummary` is the line of chips under a hosted game and beside every row in Find Game. A player browsing open games has to be able to see which mode a listing is.

**Files:**
- Modify: `web/src/components/PregameUi.tsx` (`MatchRulesSummary`, near the end of the file)
- Test: `web/src/components/__tests__/AdvancedSettings.test.ts`

**Interfaces:**
- Consumes: `VARIANT_LABELS` from Task 4, `GameConfig.variant` from Task 1.
- Produces: no new exports. `MatchRulesSummary` renders one extra chip when the variant is not `main`.

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/__tests__/AdvancedSettings.test.ts`:

```ts
describe('MatchRulesSummary variant chip', () => {
  const summary = (config: GameConfig) =>
    renderToStaticMarkup(createElement(MatchRulesSummary, { config }))

  it('says nothing about the variant for main', () => {
    // The default game needs no badge; a badge on everything is not a badge.
    expect(summary(DEFAULT_GAME_CONFIG)).not.toContain(VARIANT_LABELS.prototype)
    expect(summary(DEFAULT_GAME_CONFIG)).not.toContain(VARIANT_LABELS.main)
  })

  it('badges a prototype listing', () => {
    const config = clampGameConfig({ ...DEFAULT_GAME_CONFIG, variant: 'prototype' })
    expect(summary(config)).toContain(VARIANT_LABELS.prototype)
  })
})
```

Add `MatchRulesSummary` to the existing import from `../PregameUi` and `VARIANT_LABELS` from `../ModeSelect`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test --workspace=hidden-web -- AdvancedSettings
```

Expected: FAIL — the prototype markup does not contain `PROTOTYPE`.

- [ ] **Step 3: Add the chip**

In `web/src/components/PregameUi.tsx`:

```tsx
export function MatchRulesSummary({ config }: { config: GameConfig }) {
  return (
    <div className="match-rules-summary" aria-label="Match rules">
      {/* Only the non-default variant is badged. Marking every listing would
        * make the badge furniture rather than a warning. */}
      {config.variant !== 'main' ? (
        <span className="match-rules-variant">{VARIANT_LABELS[config.variant]}</span>
      ) : null}
      <span>
        {config.boardSize}x{config.boardSize}
      </span>
      <span>{config.rounds} rounds</span>
      <span>{config.turnSeconds}s turns</span>
      <span>{config.blindMode ? 'Blind boards' : 'Open boards'}</span>
      <span>{config.powerupsEnabled ? 'Power-ups on' : 'Power-ups off'}</span>
    </div>
  )
}
```

Add `import { VARIANT_LABELS } from './ModeSelect'` to the file's imports, and a `.match-rules-variant` rule to `web/src/prototype-mode.css` that makes the chip read as a warning rather than as another stat.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test --workspace=hidden-web -- AdvancedSettings
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/PregameUi.tsx web/src/prototype-mode.css web/src/components/__tests__/AdvancedSettings.test.ts
git commit -m "feat(web): badge the variant in the match rules summary

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Wire it into the app

The last task, and the only one whose deliverable is verified in a browser rather than by a unit test. Everything it calls is already tested.

**Files:**
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `ModeSelect` and `PROTOTYPE_WARNING` (Task 4); `quickMatchConfig`, `isPrototypeMatch`, `getResultHeadline` (Task 6); `defaultConfigForVariant` (Task 1).
- Produces: nothing. This is the top of the tree.

- [ ] **Step 1: Add the variant handler**

In `web/src/App.tsx`, beside `applyConfigPatch` (around line 124):

```tsx
  // A whole replacement rather than a patch: each variant has its own starting
  // rules, and carrying a 5x5 board into a mode that forbids it would only
  // produce a config the clamp silently rewrites.
  const applyVariant = (variant: GameVariant) =>
    setConfig(defaultConfigForVariant(variant))
```

Add `defaultConfigForVariant` and `type GameVariant` to the existing `@hidden/game-core` import, and add:

```tsx
import { ModeSelect, PROTOTYPE_WARNING } from './components/ModeSelect'
```

Add `quickMatchConfig`, `isPrototypeMatch`, and `getResultHeadline` to the existing import from `./game/viewModel`.

- [ ] **Step 2: Put the selector on the online menu**

In the `screen === 'online-menu'` block (around line 545), between `HowToPlayTrigger` and the action grid — the position the spec calls for:

```tsx
          <HowToPlayTrigger onClick={() => setHowToPlayOpen(true)} />
          <ModeSelect value={config.variant} onChange={applyVariant} />
          <div className="action-grid online-action-grid">
```

In the same block, make Quick Match carry the variant:

```tsx
            <ActionChoice
              label="QUICK MATCH"
              description="Find any available opponent."
              onClick={() => void startOnline(
                username,
                quickMatchConfig(config, authUser?.role === 'admin'),
              )}
            />
```

Note this replaces the old `authUser?.role === 'admin' ? config : undefined`. For a non-admin on `main` the proposal is now `DEFAULT_GAME_CONFIG` rather than `undefined`, which is the same rules the server would have applied anyway.

- [ ] **Step 3: Put the selector on the practice screen**

In the `screen === 'offline-setup'` block (around line 702), inside `.offline-card`, after the description and before `START PRACTICE`:

```tsx
            <p className="panel-description">
              Learn the board or tune the rules before going online.
            </p>
            <ModeSelect value={config.variant} onChange={applyVariant} />
            <BrushButton
              className="big-action"
              onClick={() => void startOffline(config)}
            >
```

`startOffline(config)` already passes the whole config, so it picks the variant up with no other change.

**Create Game needs no code change.** The `lobby-create` screen reads the same `config` state and `hostGame(username, config, isPrivateGame)` sends it whole, so a variant chosen on the online menu is already carried into a hosted game and shown by its Advanced panel. Do not add a second selector there — one piece of state, one control. Step 8 verifies this rather than implementing it.

- [ ] **Step 4: Banner the battle screen**

In the `screen === 'battle' && match` block (around line 761), inside `.battle-header`, directly after the `<h1>`:

```tsx
            <h1>Current Round: {match.currentRound}</h1>
            {isPrototypeMatch(match) ? (
              <p className="prototype-banner" role="note">
                PROTOTYPE · UNDER DEVELOPMENT — {PROTOTYPE_WARNING}
              </p>
            ) : null}
```

The banner must not resize the header when it appears; the header already keeps a fixed slot for `.battle-announcement` for exactly this reason. Give `.prototype-banner` a fixed height in `prototype-mode.css`, or confirm it only ever renders for a whole match (it does — the variant cannot change mid-match) and no reflow is possible.

- [ ] **Step 5: Report no winner on the results screen**

In the `screen === 'results' && match?.result` block (around line 854), replace the headline and score paragraph:

```tsx
            <p className="brush-subtitle">GAME OVER</p>
            <h1 className={isPrototypeMatch(match) ? 'results-tbd' : undefined}>
              {getResultHeadline(match)}
            </h1>
            {isPrototypeMatch(match) ? (
              <>
                <p className="results-note">
                  This mode has no win condition yet.
                </p>
                {/* Cell counts, not a score. Useful while playtesting; not a
                  * claim about who won. */}
                <p className="results-debug">
                  Cells held (debug) — {username.trim() || 'Player'}:{' '}
                  <b>{match.result.playerScore}</b> · {opponentName}:{' '}
                  <b>{match.result.opponentScore}</b>
                </p>
              </>
            ) : (
              <p className="results-score">
                Your Score: <b>{match.result.playerScore}</b>
                <br />
                Opponent Score: <b>{match.result.opponentScore}</b>
              </p>
            )}
```

- [ ] **Step 6: Fix the chrome status strip**

The status strip at the top also declares a result. In the `chromeStatus` derivation (around line 333):

```tsx
      : screen === 'results' && match?.result
      ? {
          tone: isPrototypeMatch(match)
            ? 'neutral'
            : match.result.outcome === 'loss'
              ? 'error'
              : 'success',
          label: isPrototypeMatch(match) ? 'PROTOTYPE COMPLETE' : 'MATCH COMPLETE',
          detail: isPrototypeMatch(match)
            ? 'No winner is declared in this mode yet.'
            : `${username} ${match.result.playerScore} · ${opponentName} ${match.result.opponentScore}`,
        }
```

Without this, the strip would announce a win the headline refuses to.

- [ ] **Step 7: Verify the whole web package**

```bash
npm test --workspace=hidden-web && npm run lint --workspace=hidden-web && npm run build --workspace=hidden-web
```

Expected: all three clean.

- [ ] **Step 8: Verify in the browser**

Start the server and the dev client, per `docs/ROADMAP.md` "Local development":

```bash
npm run build --workspace=hidden-server && npm start --workspace=hidden-server
```

Then `npm run dev` in `web/`, and open the preview. Check, in order:

1. Practice screen shows the selector; choosing PROTOTYPE shows the warning line.
2. Advanced under PROTOTYPE shows Rounds at 12 and 4x4/5x5 rendered but not selectable.
3. Start a practice match: the battle header carries the banner for the whole match.
4. Play it out against the bot: the result screen says `TBD`, not a winner, and the status strip agrees.
5. Switch back to MAIN: rounds return to 6, no banner, a real winner is declared.
6. Two tabs, both PROTOTYPE, Quick Match: they pair and the match is prototype.
7. Two tabs, one MAIN and one PROTOTYPE, both Quick Match: they do **not** pair, and both keep searching.
8. Host a prototype game under Create Game; the Find Game row carries the PROTOTYPE badge.

Take a screenshot of the practice screen with PROTOTYPE selected and of the TBD result screen.

- [ ] **Step 9: Commit**

```bash
git add web/src/App.tsx web/src/prototype-mode.css
git commit -m "feat(web): select the game mode and mark the prototype as incomplete

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification and the container

Phase 0 touches all three packages. `CLAUDE.md` requires both packages and the production container to be verified before deployment.

**Files:** none.

- [ ] **Step 1: Run every suite**

```bash
npm test --workspace=@hidden/game-core && npm test --workspace=hidden-server && npm run build --workspace=hidden-server && npm test --workspace=hidden-web && npm run lint --workspace=hidden-web && npm run build --workspace=hidden-web
```

Expected: all clean. Paste the actual output; do not claim a pass you did not read.

- [ ] **Step 2: Build the production container**

Local Docker on this machine is broken, so build and boot the production image on the Hetzner box instead:

```bash
ssh -o IdentitiesOnly=yes -i C:/Users/Phil/.ssh/hetzner_desktop_ed25519 phil@95.217.6.255
```

Build from the root `Dockerfile`, run it, and confirm `GET /healthz` answers. **The apex portfolio fakes a passing `/healthz`** — check the container's own port directly, not the public hostname.

- [ ] **Step 3: Update the roadmap**

Mark Phase 0 done in the table under `## Active work` in `docs/ROADMAP.md`:

```
| 0 | ... | Done <date> |
```

- [ ] **Step 4: Commit and open the PR**

```bash
git add docs/ROADMAP.md
git commit -m "docs: mark cube prototype phase 0 complete

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push -u origin cube-prototype-phase-0
```

Open the PR against `PhilHo-Projects/hidden`. Rebase on `main` first — other sessions land PRs there mid-task.

---

## What Phase 0 deliberately does not do

Do not start any of these. They are Phase 1, and folding them in would defeat the point of Phase 0 shipping separately.

- No cube topology, faces, or adjacency.
- No change to `boardColumns()` in `BoardGrid.tsx`.
- No map, arrows, or navigation.
- No `unlockedFaces`, padlock, or lock styling.
- No splitting of `packages/game-core/src/index.ts`.
- No change to `ENGINE_REVISION`.
