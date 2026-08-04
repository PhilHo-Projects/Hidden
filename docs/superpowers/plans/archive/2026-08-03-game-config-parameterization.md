# Game Config Parameterization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single hardcoded `classic@1` game mode with a per-match
`GameConfig` covering board size, power-up toggles, and turn rules, so rule
variants can be played and tested without a code change.

**Architecture:** `game-core` stops resolving rules through `MODE_REGISTRY` and
instead derives them from a `GameConfig` stored on the match. Versioning moves
from the variant to the engine (`ENGINE_REVISION`). The migration is
incremental: `GameConfig` is added alongside `MatchRules`, a normalization shim
lets `createGame` accept either spec shape, the server and web packages migrate
one at a time, and the final task deletes the shim and the registry. Every task
boundary leaves all three packages compiling with green tests.

**Tech Stack:** TypeScript, Vitest, React 19, Vite 8, Express 5, `ws` 8,
MessagePack 3, Node 24.

## Global Constraints

- Node 24.
- Preserve numeric packet IDs. The highest active ID is `GAME_UPDATE = 20`.
  Do not renumber an active ID. This plan adds no new packet IDs.
- The connection-assigned client ID is authoritative. Never trust a sender ID
  inside a packet.
- Add or update tests before changing runtime behavior.
- Do not log raw packet bodies at the default `info` level.
- Verification commands: `npm test`, `npm run lint`, `npm run build` in `web/`;
  `npm test` and `npm run build` in `server/`.
- The win condition is unchanged: most surviving cells wins, decided in
  `finishGame`. No task in this plan alters scoring.
- Default configuration must reproduce today's game exactly. Any task that
  changes observable default behavior is a defect.

## Status as of 2026-08-03

Done, each committed and verified green in all three packages:

- Task 1 — `createTopology`, engine constants (`c5f73a2`).
- Task 2 — `GameConfig`, defaults, decode, clamp (`885bedc`).
- Task 3 — engine driven by config, power-up toggles, no-repeat rule
  (`deccaea`).
- Tasks 5, 6, 7 — web protocol/adapter, board sizing, setup panel (`6b0580e`),
  plus power-up tray hiding (`988c0ed`) and a dev-server fix (`057472a`).

**Tasks 5-7 were done before Task 4**, contrary to the order below, so the
solo testbed became usable sooner. `createOnlineMatchConfig` therefore fills
the knobs the server does not yet send from `DEFAULT_GAME_CONFIG`, and
`App.tsx` still sends only `{ rounds, turnSeconds, blindMode }` on the
matchmaking packet. Task 4 replaces both.

Remaining: **Task 4** (server) and **Task 8** (delete the registry, the
legacy `MatchRules` exports, and the `createGame` compatibility shim).

Verified in the running app, not only in tests: a 5x5 no-power-up practice
match renders 25 cells across 5 columns with no power-up tray.

## Correction: game-core test framework

`packages/game-core` does **not** use Vitest. It runs `node --test` with
`node:assert/strict` (`npm test` in that package). Task 1, 2, 3, and 8 test
code below is written in Vitest style; translate it when implementing:
`expect(a).toBe(b)` becomes `assert.equal(a, b)`, `toEqual` becomes
`assert.deepEqual`, `toThrow(/x/)` becomes `assert.throws(fn, /x/)`, and
`toHaveLength(n)` becomes `assert.equal(value.length, n)`. `describe` and `it`
come from `node:test`. Only `server/` and `web/` use Vitest.

## Correction to the spec

The spec states that `.unity-board-grid` hardcodes `repeat(3, ...)` in two
places in `web/src/index.css`. That is wrong. Only line 1161 is the board grid.
The rule at line 1273 is `.powerup-stack`, which is the three-power-up button
row and must keep `repeat(3, ...)`. Task 6 changes line 1161 only.

---

### Task 1: Topology generation

**Files:**
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type BoardSize = 3 | 4 | 5`,
  `export function createTopology(boardSize: BoardSize, streak: number): ClassicTopology`,
  `export const ENGINE_ID: 'classic'`, `export const ENGINE_REVISION: 1`.

This task is purely additive. Nothing existing changes, so all current tests
must still pass unmodified.

- [ ] **Step 1: Write the failing tests**

Append to `packages/game-core/src/index.test.ts`:

```ts
import { createTopology, ENGINE_ID, ENGINE_REVISION } from './index'

// Written as a literal, not imported, so it still guards the 3x3 board after
// CLASSIC_V1 is deleted in Task 8.
const LEGACY_3X3_PATTERNS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

describe('createTopology', () => {
  it('reproduces the legacy 3x3 topology exactly, including pattern order', () => {
    const topology = createTopology(3, 3)
    expect(topology.locationIds).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
    expect(topology.winningPatterns).toEqual(LEGACY_3X3_PATTERNS)
  })

  it('numbers every cell of a larger board', () => {
    expect(createTopology(4, 3).locationIds).toHaveLength(16)
    expect(createTopology(5, 3).locationIds).toHaveLength(25)
  })

  it('emits every sliding window of the requested streak length', () => {
    // 4x4 with streak 4: 4 rows + 4 columns + 2 diagonals.
    expect(createTopology(4, 4).winningPatterns).toHaveLength(10)
    // 4x4 with streak 3: 4 rows x 2 windows, 4 columns x 2 windows,
    // and 4 diagonal windows in each direction.
    expect(createTopology(4, 3).winningPatterns).toHaveLength(24)
  })

  it('produces patterns of exactly the streak length', () => {
    for (const pattern of createTopology(5, 4).winningPatterns) {
      expect(pattern).toHaveLength(4)
    }
  })

  it('rejects a streak that cannot fit on the board', () => {
    expect(() => createTopology(3, 4)).toThrow(/streak/i)
    expect(() => createTopology(3, 1)).toThrow(/streak/i)
  })

  it('exposes the engine identity', () => {
    expect(ENGINE_ID).toBe('classic')
    expect(ENGINE_REVISION).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "E:/Unity Projects/Hidden/packages/game-core" && npx vitest run src/index.test.ts
```

Expected: FAIL. `createTopology is not a function`, and `ENGINE_ID` /
`ENGINE_REVISION` are not exported.

- [ ] **Step 3: Implement**

Add to `packages/game-core/src/index.ts`, immediately above the existing
`export interface ModeRef` block:

```ts
export const ENGINE_ID = 'classic' as const
export const ENGINE_REVISION = 1 as const

export type BoardSize = 3 | 4 | 5

export interface EngineRef {
  readonly id: typeof ENGINE_ID
  readonly revision: number
}

// Pattern order matters: it is asserted against the legacy 3x3 board, and
// `maybeUnlockPowerup` returns on the first match, so reordering would change
// which power-up unlocks when two lines complete at once.
export function createTopology(
  boardSize: BoardSize,
  streak: number,
): ClassicTopology {
  if (!Number.isInteger(streak) || streak < 2 || streak > boardSize) {
    throw new Error(
      `Invalid streak ${streak} for a ${boardSize}x${boardSize} board.`,
    )
  }

  const locationIds: LocationId[] = []
  for (let index = 0; index < boardSize * boardSize; index += 1) {
    locationIds.push(index)
  }

  const at = (row: number, column: number) => row * boardSize + column
  const winningPatterns: LocationId[][] = []
  const windows = boardSize - streak + 1
  const offsets: LocationId[] = []
  for (let step = 0; step < streak; step += 1) offsets.push(step)

  for (let row = 0; row < boardSize; row += 1) {
    for (let column = 0; column < windows; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row, column + step)))
    }
  }
  for (let column = 0; column < boardSize; column += 1) {
    for (let row = 0; row < windows; row += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column)))
    }
  }
  for (let row = 0; row < windows; row += 1) {
    for (let column = 0; column < windows; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column + step)))
    }
  }
  for (let row = 0; row < windows; row += 1) {
    for (let column = streak - 1; column < boardSize; column += 1) {
      winningPatterns.push(offsets.map((step) => at(row + step, column - step)))
    }
  }

  return deepFreeze({ locationIds, winningPatterns })
}
```

Move the existing `deepFreeze` function definition above `createTopology` if
TypeScript reports it as used before declaration. Function declarations hoist,
so this is likely unnecessary.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "E:/Unity Projects/Hidden/packages/game-core" && npx vitest run
```

Expected: PASS, including every pre-existing test.

If the legacy-order assertion fails, do not change the assertion. Reorder the
four loops in `createTopology` until the 3x3 output matches. The legacy order is
rows, then columns, then the down-right diagonal, then the down-left diagonal.

- [ ] **Step 5: Commit**

```bash
git add packages/game-core/src/index.ts packages/game-core/src/index.test.ts
git commit -m "feat(core): generate board topologies from size and streak"
```

---

### Task 2: GameConfig type, defaults, decode, and clamp

**Files:**
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: `BoardSize` from Task 1.
- Produces: `export interface GameConfig`,
  `export const DEFAULT_GAME_CONFIG: Readonly<GameConfig>`,
  `export function decodeGameConfig(value: unknown): GameConfig | undefined`,
  `export function clampGameConfig(value: unknown): GameConfig`.

Still purely additive. `MatchRules`, `decodeMatchRules`, and `clampMatchRules`
remain untouched and exported; they are removed in Task 8.

- [ ] **Step 1: Write the failing tests**

Append to `packages/game-core/src/index.test.ts`:

```ts
import {
  clampGameConfig,
  decodeGameConfig,
  DEFAULT_GAME_CONFIG,
} from './index'

describe('GameConfig', () => {
  it('defaults to the game as it plays today', () => {
    expect(DEFAULT_GAME_CONFIG).toEqual({
      boardSize: 3,
      streak: 3,
      rounds: 6,
      turnSeconds: 10,
      blindMode: true,
      powerupsEnabled: true,
      powerups: { shield: true, reveal: true, extraTurn: true },
      powerupBySymbol: { rock: 'shield', paper: 'reveal', scissors: 'extraTurn' },
      forbidImmediateRepeat: false,
    })
  })

  it('decodes a complete config', () => {
    const decoded = decodeGameConfig({
      boardSize: 5,
      streak: 4,
      rounds: 12,
      turnSeconds: 15,
      blindMode: false,
      powerupsEnabled: false,
      powerups: { shield: false, reveal: true, extraTurn: false },
      powerupBySymbol: { rock: 'reveal', paper: 'shield', scissors: 'extraTurn' },
      forbidImmediateRepeat: true,
    })
    expect(decoded?.boardSize).toBe(5)
    expect(decoded?.streak).toBe(4)
    expect(decoded?.powerupsEnabled).toBe(false)
    expect(decoded?.forbidImmediateRepeat).toBe(true)
  })

  it('fills missing fields from defaults instead of failing', () => {
    // A stale client must degrade to the default game, not fail to join.
    expect(decodeGameConfig({ boardSize: 4 })).toEqual({
      ...DEFAULT_GAME_CONFIG,
      boardSize: 4,
    })
  })

  it('rejects values that are not objects', () => {
    for (const value of [null, undefined, 7, 'config', []]) {
      expect(decodeGameConfig(value)).toBeUndefined()
    }
  })

  it('clamps every numeric field into range', () => {
    const clamped = clampGameConfig({
      boardSize: 9,
      streak: 99,
      rounds: 999,
      turnSeconds: 0,
    })
    expect(clamped.boardSize).toBe(5)
    expect(clamped.rounds).toBe(20)
    expect(clamped.turnSeconds).toBe(2)
    expect(clamped.streak).toBeLessThanOrEqual(clamped.boardSize)
    expect(clamped.streak).toBeGreaterThanOrEqual(2)
  })

  it('clamps streak against the clamped board size, not the requested one', () => {
    expect(clampGameConfig({ boardSize: 3, streak: 5 }).streak).toBe(3)
  })

  it('coerces malformed booleans and power-up maps to defaults', () => {
    const clamped = clampGameConfig({
      blindMode: 'yes',
      powerupsEnabled: 1,
      powerups: { shield: 'no' },
      powerupBySymbol: { rock: 'nonsense' },
    })
    expect(clamped.blindMode).toBe(true)
    expect(clamped.powerupsEnabled).toBe(true)
    expect(clamped.powerups.shield).toBe(true)
    expect(clamped.powerupBySymbol.rock).toBe('shield')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "E:/Unity Projects/Hidden/packages/game-core" && npx vitest run src/index.test.ts
```

Expected: FAIL. `decodeGameConfig is not a function`.

- [ ] **Step 3: Implement**

Add to `packages/game-core/src/index.ts` after `createTopology`:

```ts
export interface GameConfig {
  readonly boardSize: BoardSize
  readonly streak: number
  readonly rounds: number
  readonly turnSeconds: number
  readonly blindMode: boolean
  readonly powerupsEnabled: boolean
  readonly powerups: Readonly<Record<PowerupKey, boolean>>
  readonly powerupBySymbol: Readonly<Record<ClassicSymbol, PowerupKey>>
  readonly forbidImmediateRepeat: boolean
}

export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = deepFreeze({
  boardSize: 3,
  streak: 3,
  rounds: 6,
  turnSeconds: 10,
  blindMode: true,
  powerupsEnabled: true,
  powerups: { shield: true, reveal: true, extraTurn: true },
  powerupBySymbol: { rock: 'shield', paper: 'reveal', scissors: 'extraTurn' },
  forbidImmediateRepeat: false,
}) as Readonly<GameConfig>

const BOARD_SIZES: readonly BoardSize[] = [3, 4, 5]
const SYMBOLS: readonly ClassicSymbol[] = ['rock', 'paper', 'scissors']
const POWERUP_KEYS: readonly PowerupKey[] = ['shield', 'reveal', 'extraTurn']

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numeric = finiteNumberOrDefault(value, fallback)
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

function booleanOrDefault(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

// Tolerant by design: unknown fields are ignored and missing fields fall back
// to the default game, so an older client degrades instead of failing to join.
export function clampGameConfig(value: unknown): GameConfig {
  const candidate =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}

  const requestedSize = clampInteger(
    candidate.boardSize,
    3,
    5,
    DEFAULT_GAME_CONFIG.boardSize,
  )
  const boardSize = (BOARD_SIZES.includes(requestedSize as BoardSize)
    ? requestedSize
    : DEFAULT_GAME_CONFIG.boardSize) as BoardSize

  const powerupsInput =
    candidate.powerups && typeof candidate.powerups === 'object'
      ? (candidate.powerups as Record<string, unknown>)
      : {}
  const powerups = {} as Record<PowerupKey, boolean>
  for (const key of POWERUP_KEYS) {
    powerups[key] = booleanOrDefault(
      powerupsInput[key],
      DEFAULT_GAME_CONFIG.powerups[key],
    )
  }

  const mappingInput =
    candidate.powerupBySymbol && typeof candidate.powerupBySymbol === 'object'
      ? (candidate.powerupBySymbol as Record<string, unknown>)
      : {}
  const powerupBySymbol = {} as Record<ClassicSymbol, PowerupKey>
  for (const symbol of SYMBOLS) {
    const mapped = mappingInput[symbol]
    powerupBySymbol[symbol] = POWERUP_KEYS.includes(mapped as PowerupKey)
      ? (mapped as PowerupKey)
      : DEFAULT_GAME_CONFIG.powerupBySymbol[symbol]
  }

  return {
    boardSize,
    streak: clampInteger(candidate.streak, 2, boardSize, Math.min(3, boardSize)),
    rounds: clampInteger(candidate.rounds, 1, 20, DEFAULT_GAME_CONFIG.rounds),
    turnSeconds: clampInteger(
      candidate.turnSeconds,
      2,
      60,
      DEFAULT_GAME_CONFIG.turnSeconds,
    ),
    blindMode: booleanOrDefault(candidate.blindMode, DEFAULT_GAME_CONFIG.blindMode),
    powerupsEnabled: booleanOrDefault(
      candidate.powerupsEnabled,
      DEFAULT_GAME_CONFIG.powerupsEnabled,
    ),
    powerups,
    powerupBySymbol,
    forbidImmediateRepeat: booleanOrDefault(
      candidate.forbidImmediateRepeat,
      DEFAULT_GAME_CONFIG.forbidImmediateRepeat,
    ),
  }
}

export function decodeGameConfig(value: unknown): GameConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return clampGameConfig(value)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "E:/Unity Projects/Hidden/packages/game-core" && npx vitest run
```

Expected: PASS, including every pre-existing test.

- [ ] **Step 5: Commit**

```bash
git add packages/game-core/src/index.ts packages/game-core/src/index.test.ts
git commit -m "feat(core): add GameConfig with tolerant decode and clamp"
```

---

### Task 3: Drive the engine from GameConfig

**Files:**
- Modify: `packages/game-core/src/index.ts`
- Test: `packages/game-core/src/index.test.ts`

**Interfaces:**
- Consumes: `GameConfig`, `DEFAULT_GAME_CONFIG`, `clampGameConfig`,
  `createTopology`, `ENGINE_ID`, `ENGINE_REVISION`, `EngineRef`.
- Produces: `GameSpec` gains optional `engine?: EngineRef` and
  `config?: GameConfig`; `GameState` gains
  `readonly config: GameConfig` and
  `readonly lastPlacedLocation: readonly [LocationId | null, LocationId | null]`;
  `RejectionReason` gains `'repeat-location'`.

`GameSpec.mode` and `GameSpec.rules` stay optional-compatible through a
normalization shim so `server/` and `web/` keep compiling until Tasks 4 and 5.

- [ ] **Step 1: Write the failing tests**

Append to `packages/game-core/src/index.test.ts`:

```ts
import {
  applyCommand,
  createGame,
  type GameConfig,
  type GameState,
} from './index'

function newGame(overrides: Partial<GameConfig> = {}, seed = 1): GameState {
  return createGame({
    engine: { id: 'classic', revision: 1 },
    config: clampGameConfig({ ...DEFAULT_GAME_CONFIG, ...overrides }),
    seed,
    firstSeat: 0,
  })
}

describe('config-driven engine', () => {
  it('accepts a legacy mode+rules spec and produces the default game', () => {
    const legacy = createGame({
      mode: { id: 'classic', revision: 1 },
      rules: { rounds: 6, turnSeconds: 10, blindMode: true },
      seed: 42,
      firstSeat: 0,
    })
    expect(legacy.config).toEqual(DEFAULT_GAME_CONFIG)
    expect(legacy.boards[0].locations).toHaveLength(9)
  })

  it('builds a board sized by the config', () => {
    expect(newGame({ boardSize: 5, streak: 4 }).boards[0].locations).toHaveLength(25)
  })

  it('rejects a spec from a different engine revision', () => {
    expect(() =>
      createGame({
        engine: { id: 'classic', revision: 2 },
        config: DEFAULT_GAME_CONFIG,
        seed: 1,
        firstSeat: 0,
      }),
    ).toThrow(/engine/i)
  })

  it('never unlocks a power-up when power-ups are disabled', () => {
    // 3x3, streak 2, so a line forms after two placements in a row.
    let state = newGame({ powerupsEnabled: false, streak: 2 })
    for (const locationId of [0, 1]) {
      const mine = applyCommand(state, state.activeSeat, {
        type: 'place',
        locationId,
        symbol: 'rock',
      })
      state = mine.state
      expect(mine.events.some((event) => event.type === 'powerup-unlocked')).toBe(false)
      const theirs = applyCommand(state, state.activeSeat, {
        type: 'place',
        locationId: locationId + 3,
        symbol: 'paper',
      })
      state = theirs.state
    }
    expect(state.powerups[0].unlocked.shield).toBe(false)
  })

  it('rejects activating a power-up when power-ups are disabled', () => {
    const state = newGame({ powerupsEnabled: false })
    const result = applyCommand(state, 0, { type: 'activate-powerup', powerup: 'shield' })
    expect(result.accepted).toBe(false)
    expect(result.rejection?.reason).toBe('powerup-locked')
  })

  it('never unlocks an individually disabled power-up', () => {
    let state = newGame({
      streak: 2,
      powerups: { shield: false, reveal: true, extraTurn: true },
    })
    state = applyCommand(state, 0, { type: 'place', locationId: 0, symbol: 'rock' }).state
    state = applyCommand(state, 1, { type: 'place', locationId: 4, symbol: 'paper' }).state
    const unlock = applyCommand(state, 0, { type: 'place', locationId: 1, symbol: 'rock' })
    expect(unlock.events.some((event) => event.type === 'powerup-unlocked')).toBe(false)
  })

  it('bars a seat from replaying its own previous location when configured', () => {
    let state = newGame({ forbidImmediateRepeat: true, powerupsEnabled: false })
    state = applyCommand(state, 0, { type: 'place', locationId: 4, symbol: 'rock' }).state
    state = applyCommand(state, 1, { type: 'place', locationId: 4, symbol: 'paper' }).state
    // Seat 0's rock lost to paper, so location 4 is empty on its board again.
    const repeat = applyCommand(state, 0, { type: 'place', locationId: 4, symbol: 'scissors' })
    expect(repeat.accepted).toBe(false)
    expect(repeat.rejection?.reason).toBe('repeat-location')
  })

  it('permits the same location once a turn has passed', () => {
    let state = newGame({ forbidImmediateRepeat: true, powerupsEnabled: false })
    state = applyCommand(state, 0, { type: 'place', locationId: 4, symbol: 'rock' }).state
    state = applyCommand(state, 1, { type: 'place', locationId: 4, symbol: 'paper' }).state
    state = applyCommand(state, 0, { type: 'place', locationId: 0, symbol: 'rock' }).state
    state = applyCommand(state, 1, { type: 'place', locationId: 1, symbol: 'rock' }).state
    const later = applyCommand(state, 0, { type: 'place', locationId: 4, symbol: 'rock' })
    expect(later.accepted).toBe(true)
  })

  it('allows repeats when the rule is off', () => {
    let state = newGame({ forbidImmediateRepeat: false, powerupsEnabled: false })
    state = applyCommand(state, 0, { type: 'place', locationId: 4, symbol: 'rock' }).state
    state = applyCommand(state, 1, { type: 'place', locationId: 4, symbol: 'paper' }).state
    expect(
      applyCommand(state, 0, { type: 'place', locationId: 4, symbol: 'scissors' }).accepted,
    ).toBe(true)
  })

  it('is deterministic for a given seed, config, and command list', () => {
    const run = () => {
      let state = newGame({ boardSize: 4, streak: 3, turnSeconds: 5 }, 99)
      for (let index = 0; index < 8; index += 1) {
        state = applyCommand(state, state.activeSeat, { type: 'timeout' }).state
      }
      return state
    }
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "E:/Unity Projects/Hidden/packages/game-core" && npx vitest run src/index.test.ts
```

Expected: FAIL. `createGame` rejects the `engine`/`config` spec shape, and
`state.config` is undefined.

- [ ] **Step 3: Implement**

In `packages/game-core/src/index.ts`, make these edits.

Replace `GameSpec` with:

```ts
export interface GameSpec {
  readonly engine?: EngineRef
  readonly config?: GameConfig
  /** @deprecated Legacy shape. Removed in the mode-registry cleanup. */
  readonly mode?: ModeRef
  /** @deprecated Legacy shape. Removed in the mode-registry cleanup. */
  readonly rules?: MatchRules
  readonly seed: number
  readonly firstSeat: Seat
}

export interface ResolvedGameSpec {
  readonly engine: EngineRef
  readonly config: GameConfig
  readonly seed: number
  readonly firstSeat: Seat
}

// Accepts either the legacy `{ mode, rules }` shape or the current
// `{ engine, config }` shape. Deleted once server and web have migrated.
function resolveSpec(spec: GameSpec): ResolvedGameSpec {
  const engine = spec.engine ?? { id: ENGINE_ID, revision: ENGINE_REVISION }
  if (engine.id !== ENGINE_ID || engine.revision !== ENGINE_REVISION) {
    throw new Error(
      `Unsupported engine ${engine.id}@${engine.revision}; this build runs ${ENGINE_ID}@${ENGINE_REVISION}.`,
    )
  }
  const config = spec.config
    ? clampGameConfig(spec.config)
    : clampGameConfig({ ...DEFAULT_GAME_CONFIG, ...(spec.rules ?? {}) })
  return { engine, config, seed: spec.seed >>> 0, firstSeat: spec.firstSeat }
}
```

Add to `GameState`, replacing its `spec` and `mode` declarations:

```ts
  readonly spec: ResolvedGameSpec
  readonly mode: ClassicMode
  readonly config: GameConfig
  readonly lastPlacedLocation: readonly [LocationId | null, LocationId | null]
```

Add `'repeat-location'` to the `RejectionReason` union.

Add a mode builder and replace `createGame`:

```ts
function buildMode(config: GameConfig): ClassicMode {
  return deepFreeze({
    id: ENGINE_ID,
    revision: ENGINE_REVISION,
    randomAlgorithm: 'mulberry32-v1',
    topology: createTopology(config.boardSize, config.streak),
    defeats: { rock: 'scissors', paper: 'rock', scissors: 'paper' },
    powerupBySymbol: config.powerupBySymbol,
  }) as ClassicMode
}

export function createGame(spec: GameSpec): GameState {
  const resolved = resolveSpec(spec)
  const mode = buildMode(resolved.config)

  return {
    spec: resolved,
    mode,
    config: resolved.config,
    phase: 'active',
    boards: [createBoard(mode), createBoard(mode)],
    powerups: [createPowerups(), createPowerups()],
    activeSeat: resolved.firstSeat,
    turnCount: 0,
    currentRound: 1,
    maxTurns: resolved.config.rounds * 2,
    pendingExtraPlacements: [],
    lastPlacedLocation: [null, null],
    result: null,
    randomState: resolved.seed,
  }
}
```

`createGame` no longer takes a registry argument. Callers passing one are a
type error; there are none outside tests.

In `cloneState`, replace the `spec` clone and add the new field:

```ts
    spec: {
      engine: { ...state.spec.engine },
      config: state.spec.config,
      seed: state.spec.seed,
      firstSeat: state.spec.firstSeat,
    },
    lastPlacedLocation: [...state.lastPlacedLocation] as [
      LocationId | null,
      LocationId | null,
    ],
```

`config` is already deep-frozen, so sharing the reference is safe and avoids
re-cloning a nested object on every command.

Replace the two `state.spec.rules.rounds` references inside `consumeTurn` and
`resolveAutomaticPasses` with `state.config.rounds`.

In `maybeUnlockPowerup`, guard on the toggles by inserting at the top of the
function body:

```ts
  if (!state.config.powerupsEnabled) return
```

and immediately after `const powerup = state.mode.powerupBySymbol[symbol]`:

```ts
    if (!state.config.powerups[powerup]) continue
```

Using `continue` rather than `return` lets a different line unlock a still-enabled
power-up on the same turn.

In `activatePowerup`, insert before the `unlocked` check:

```ts
  if (!state.config.powerupsEnabled) return reject(state, 'powerup-locked')
```

In `place`, insert after the `shieldSelectionPending` guard:

```ts
  if (
    state.config.forbidImmediateRepeat &&
    state.lastPlacedLocation[seat] === command.locationId
  ) {
    return reject(state, 'repeat-location')
  }
```

and record the placement immediately after the `setLocation` call that writes
the symbol:

```ts
  ;(next.lastPlacedLocation as (LocationId | null)[])[seat] = command.locationId
```

Placing this after `setLocation` means timeouts recorded through `applyTimeout`
also update the field, because `applyTimeout` delegates to `place`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "E:/Unity Projects/Hidden/packages/game-core" && npx vitest run
```

Expected: PASS. Pre-existing tests that construct a game with
`{ mode, rules }` still pass through the shim.

- [ ] **Step 5: Verify the other packages still compile**

```bash
cd "E:/Unity Projects/Hidden/server" && npm run build
```

```bash
cd "E:/Unity Projects/Hidden/web" && npm run build
```

Expected: both succeed. If `server` fails on `createGame(spec)` passing a second
argument, remove that argument; that is the only expected breakage.

- [ ] **Step 6: Commit**

```bash
git add packages/game-core/src/index.ts packages/game-core/src/index.test.ts
git commit -m "feat(core): derive board and power-up rules from GameConfig"
```

---

### Task 4: Carry GameConfig through the server

**Files:**
- Modify: `server/src/matchRules.ts`
- Modify: `server/src/protocol.ts`
- Modify: `server/src/matchCoordinator.ts`
- Test: `server/src/matchRules.test.ts`, `server/src/protocol.test.ts`,
  `server/src/app.test.ts`

**Interfaces:**
- Consumes: `GameConfig`, `decodeGameConfig`, `clampGameConfig`,
  `DEFAULT_GAME_CONFIG`, `ENGINE_ID`, `ENGINE_REVISION` from `@hidden/game-core`.
- Produces: `GameStartDescriptor` carries
  `engine: EngineRef` and `config: GameConfig` in place of `mode` and `rules`;
  `MatchRoom.config` replaces `MatchRoom.rules`; the matchmaking request field
  at packet index 3 carries a `GameConfig` object.

- [ ] **Step 1: Write the failing tests**

In `server/src/matchRules.test.ts`, add:

```ts
import { clampGameConfig, decodeGameConfig } from './matchRules'

describe('game config transport', () => {
  it('re-exports a tolerant decoder', () => {
    expect(decodeGameConfig({ boardSize: 5, streak: 4 })?.boardSize).toBe(5)
    expect(decodeGameConfig('nope')).toBeUndefined()
  })

  it('clamps a hostile config', () => {
    const clamped = clampGameConfig({ boardSize: 99, rounds: -4, streak: 99 })
    expect(clamped.boardSize).toBe(5)
    expect(clamped.rounds).toBe(1)
    expect(clamped.streak).toBe(5)
  })
})
```

In `server/src/protocol.test.ts`, add:

```ts
it('decodes a proposed game config on a matchmaking request', () => {
  const decoded = decodePacket(
    encodeForTest([13, 1, 0, { boardSize: 4, streak: 3, rounds: 8 }]),
  )
  expect(decoded.type).toBe('matchmaking-request')
  expect(decoded.proposedConfig?.boardSize).toBe(4)
  expect(decoded.proposedConfig?.rounds).toBe(8)
})

it('falls back to no proposal when the config field is malformed', () => {
  const decoded = decodePacket(encodeForTest([13, 1, 0, 'garbage']))
  expect(decoded.proposedConfig).toBeUndefined()
})
```

Match the surrounding file's existing helper for building a packet; the two
calls above use `encodeForTest` as a stand-in. Read the top of
`server/src/protocol.test.ts` and reuse whatever the neighbouring
`proposedRules` tests already use.

In `server/src/app.test.ts`, update the existing rules tests: replace every
`proposedRules: { rounds, turnSeconds, blindMode }` with
`proposedConfig: { rounds, turnSeconds, blindMode }`, and replace the expected
`{ rounds, turnSeconds, blindMode }` objects with
`expect.objectContaining({ rounds, turnSeconds, blindMode })` so the added
config fields do not break the assertion. Change the two `mode:` assertions to:

```ts
      engine: { id: 'classic', revision: 1 },
```

Add one new test. Copy the body of the existing test at
`server/src/app.test.ts:755` (`proposedRules` from two queuers, first proposal
wins) and change only the proposal and the assertion:

```ts
it('starts a match on the board size the first queuer proposed', async () => {
  // Same harness and setup as the existing first-proposal-wins test.
  // Only the proposed config and the final assertion differ.
  const expected = expect.objectContaining({ boardSize: 5, streak: 4 })
  // ...queue seat 0 with { boardSize: 5, streak: 4 }, queue seat 1 with
  // { boardSize: 3, streak: 3 }, then assert on the start descriptor:
  expect(descriptor.config).toEqual(expected)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "E:/Unity Projects/Hidden/server" && npm test
```

Expected: FAIL on the new assertions and on `proposedConfig` being undefined.

- [ ] **Step 3: Implement**

`server/src/matchRules.ts` — re-export the config helpers alongside the
existing rules helpers:

```ts
export {
  clampGameConfig,
  decodeGameConfig,
  DEFAULT_GAME_CONFIG,
} from '@hidden/game-core'
export type { GameConfig } from '@hidden/game-core'
```

`server/src/protocol.ts` — rename the matchmaking request field. Change the
declared shape at line 76 from `proposedRules?: MatchRules` to
`proposedConfig?: GameConfig`, and change the decode at line 248 from
`decodeMatchRules(packet[3])` to `decodeGameConfig(packet[3])`. Update the
import accordingly.

`server/src/matchCoordinator.ts`:

- Import `type GameConfig`, `clampGameConfig`, `DEFAULT_GAME_CONFIG`,
  `ENGINE_ID`, `ENGINE_REVISION`, `type EngineRef`. Drop the `ModeRef`,
  `MatchRules`, `clampMatchRules`, and `DEFAULT_MATCH_RULES` imports.
- Rename `rules` to `config` on the room and queue types (lines 83, 93, 101,
  148) and change the type to `GameConfig`.
- Replace `freezeRules` with:

```ts
function freezeConfig(config: GameConfig): GameConfig {
  return Object.freeze({ ...config })
}
```

- Replace `freezeSpec` with:

```ts
function freezeSpec(spec: ResolvedGameSpec): ResolvedGameSpec {
  return Object.freeze({
    ...spec,
    engine: Object.freeze({ ...spec.engine }),
  })
}
```

- Change `GameStartDescriptor` (line 98) to:

```ts
export interface GameStartDescriptor {
  readonly matchId: string
  readonly engine: EngineRef
  readonly config: GameConfig
  readonly seed: number
  readonly firstSeat: Seat
  readonly revision: 0
  readonly turnTimeRemainingMs: number
}
```

- At line 788, read the turn length from the config:

```ts
    const turnTimeRemainingMs =
      MATCH_START_GRACE_MS + room.config.turnSeconds * 1_000
```

- At line 789, build the spec from the config:

```ts
    const spec = freezeSpec({
      engine: { id: ENGINE_ID, revision: ENGINE_REVISION },
      config: room.config,
      seed: this.dependencies.createSeed() >>> 0,
      firstSeat: this.dependencies.chooseFirstSeat(),
    })
```

- At line 814, emit the new descriptor fields:

```ts
    const descriptor: GameStartDescriptor = Object.freeze({
      matchId: run.id,
      engine: spec.engine,
      config: spec.config,
      seed: spec.seed,
      firstSeat: spec.firstSeat,
      revision: 0,
      turnTimeRemainingMs,
    })
```

- Replace the two `clampMatchRules(proposedRules)` calls (lines 233 and 270)
  with `clampGameConfig(proposedConfig)`, and the `DEFAULT_MATCH_RULES`
  parameter default at line 258 with `DEFAULT_GAME_CONFIG`.
- Search the file for any remaining `.rules` access and change it to `.config`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "E:/Unity Projects/Hidden/server" && npm test && npm run build
```

Expected: PASS and a clean build.

- [ ] **Step 5: Commit**

```bash
git add server/src
git commit -m "feat(server): carry GameConfig through matchmaking and match start"
```

---

### Task 5: Carry GameConfig through the web client

**Files:**
- Modify: `web/src/game/types.ts`
- Modify: `web/src/game/protocol.ts`
- Modify: `web/src/game/coreAdapter.ts:216-231`
- Modify: `web/src/game/onlineMatch.ts`
- Test: `web/src/game/__tests__/protocol.test.ts`,
  `web/src/game/coreAdapter.test.ts`, `web/src/game/onlineMatch.test.ts`

**Interfaces:**
- Consumes: the server's `GameStartDescriptor` shape from Task 4.
- Produces: `MatchConfig` becomes
  `GameConfig & { isOnline: boolean; hasAI: boolean }`.

- [ ] **Step 1: Write the failing tests**

In `web/src/game/__tests__/protocol.test.ts`, change every
`mode: { id: 'classic', revision: 1 }` to
`engine: { id: 'classic', revision: 1 }`, add
`config: { boardSize: 3, streak: 3, rounds: 6, turnSeconds: 10, blindMode: true, powerupsEnabled: true, powerups: { shield: true, reveal: true, extraTurn: true }, powerupBySymbol: { rock: 'shield', paper: 'reveal', scissors: 'extraTurn' }, forbidImmediateRepeat: false }`
to the descriptor fixtures, and change the rejection test at line 97 from
`mode: { id: 'classic', revision: 2 }` to
`engine: { id: 'classic', revision: 2 }`.

Add:

```ts
it('carries the board size through a game start', () => {
  const decoded = decodeGameStart({
    ...validStartPayload,
    config: { ...validStartPayload.config, boardSize: 5, streak: 4 },
  })
  expect(decoded.config.boardSize).toBe(5)
  expect(decoded.config.streak).toBe(4)
})
```

In `web/src/game/coreAdapter.test.ts`, change the `config` fixture at line 18
to spread the default game config:

```ts
const config: MatchConfig = {
  ...DEFAULT_GAME_CONFIG,
  isOnline: false,
  hasAI: true,
}
```

Add:

```ts
it('creates an offline board at the configured size', () => {
  const state = createOfflineState(
    { ...config, boardSize: 5, streak: 4 },
    true,
    123,
  )
  expect(state.canonicalState?.boards[0].locations).toHaveLength(25)
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "E:/Unity Projects/Hidden/web" && npx vitest run
```

Expected: FAIL. `decodeGameStart` rejects `engine`, and `MatchConfig` has no
`boardSize`.

- [ ] **Step 3: Implement**

`web/src/game/types.ts` line 25 — replace `MatchConfig` with:

```ts
import type { GameConfig } from '@hidden/game-core'

export interface MatchConfig extends GameConfig {
  isOnline: boolean
  hasAI: boolean
}
```

`web/src/game/protocol.ts`:

- Line 71 — replace the descriptor's `mode` field with:

```ts
  readonly engine: { readonly id: 'classic'; readonly revision: number }
  readonly config: GameConfig
```

- Lines 286-289 — validate the engine instead of the mode:

```ts
  if (
    value.engine?.id !== ENGINE_ID ||
    value.engine?.revision !== ENGINE_REVISION
  ) {
    throw new Error('Unsupported engine revision.')
  }
```

- Line 307 — build the decoded descriptor with:

```ts
    engine: { id: ENGINE_ID, revision: ENGINE_REVISION },
    config: clampGameConfig(value.config),
```

Import `ENGINE_ID`, `ENGINE_REVISION`, `clampGameConfig`, and `type GameConfig`
from `@hidden/game-core`.

`web/src/game/coreAdapter.ts` lines 222-231 — replace the `createGame` call:

```ts
  const canonicalState = createGame({
    engine: { id: ENGINE_ID, revision: ENGINE_REVISION },
    config,
    seed,
    firstSeat: isMyTurn ? localSeat : opponentOf(localSeat),
  })
```

`config` is a `MatchConfig`, which structurally satisfies `GameConfig`; the two
extra fields are ignored by `clampGameConfig`.

`web/src/game/onlineMatch.ts` — `createOnlineMatchConfig` currently builds a
`MatchConfig` from the server rules. Change it to spread the server config:

```ts
export function createOnlineMatchConfig(config: GameConfig): MatchConfig {
  return { ...clampGameConfig(config), isOnline: true, hasAI: false }
}
```

Update its call site to pass `descriptor.config`, and update
`onlineMatch.test.ts` fixtures the same way as the other tests.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "E:/Unity Projects/Hidden/web" && npm test && npm run lint && npm run build
```

Expected: PASS, clean lint, clean build.

- [ ] **Step 5: Commit**

```bash
git add web/src
git commit -m "feat(web): carry GameConfig through protocol and offline setup"
```

---

### Task 6: Render boards at the configured size

**Files:**
- Modify: `web/src/components/BoardGrid.tsx:68`
- Modify: `web/src/index.css:1161`
- Test: `web/src/components/__tests__/BoardGrid.test.tsx`

**Interfaces:**
- Consumes: nothing new. The column count is derived from `grid.cells.length`,
  so no prop threading is required and every existing `BoardGrid` call site
  keeps working unchanged.
- Produces: the board grid element carries a `--board-size` CSS custom property.

- [ ] **Step 1: Write the failing test**

Create or append to `web/src/components/__tests__/BoardGrid.test.tsx`:

```tsx
import { render } from '@testing-library/react'
import { BoardGrid } from '../BoardGrid'
import type { GridState } from '../../game/types'

function gridOf(count: number): GridState {
  return {
    cells: Array.from({ length: count }, () => ({
      occupied: false,
      color: null,
      immune: false,
    })),
  }
}

describe('BoardGrid sizing', () => {
  it.each([
    [9, '3'],
    [16, '4'],
    [25, '5'],
  ])('renders %i cells as a %s-column grid', (count, columns) => {
    const { container } = render(
      <BoardGrid title="" subtitle="Board" grid={gridOf(count)} />,
    )
    const board = container.querySelector('.unity-board-grid') as HTMLElement
    expect(board.style.getPropertyValue('--board-size')).toBe(columns)
  })

  it('falls back to 3 columns for an empty setup-phase grid', () => {
    const { container } = render(
      <BoardGrid title="" subtitle="Board" grid={gridOf(0)} />,
    )
    const board = container.querySelector('.unity-board-grid') as HTMLElement
    expect(board.style.getPropertyValue('--board-size')).toBe('3')
  })
})
```

If `@testing-library/react` is not already a dev dependency of `web/`, check
`web/package.json` first. If it is absent, replace this test with a unit test of
an exported `boardColumns(cellCount: number): number` helper instead of
rendering, and assert `boardColumns(0) === 3`, `boardColumns(16) === 4`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "E:/Unity Projects/Hidden/web" && npx vitest run src/components/__tests__/BoardGrid.test.tsx
```

Expected: FAIL. `--board-size` is empty.

- [ ] **Step 3: Implement**

In `web/src/components/BoardGrid.tsx`, add above the component:

```tsx
// Boards are always square, so the column count is recoverable from the cell
// count. Deriving it here avoids threading board size through every call site.
export function boardColumns(cellCount: number) {
  if (cellCount <= 0) return 3
  return Math.round(Math.sqrt(cellCount))
}
```

Change line 68 to:

```tsx
      <div
        className="unity-board-grid"
        style={{ '--board-size': String(boardColumns(grid.cells.length)) } as CSSProperties}
      >
```

`CSSProperties` is already imported at line 5.

In `web/src/index.css`, change line 1161 to:

```css
  grid-template-columns: repeat(var(--board-size, 3), minmax(0, 1fr));
```

Do not touch line 1273. That rule is `.powerup-stack`, the three-power-up
button row, and must stay at `repeat(3, ...)`.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "E:/Unity Projects/Hidden/web" && npm test && npm run lint && npm run build
```

Expected: PASS, clean lint, clean build.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/BoardGrid.tsx web/src/index.css web/src/components/__tests__
git commit -m "feat(web): render the board at the configured size"
```

---

### Task 7: Expose the knobs in the pregame setup panel

**Files:**
- Modify: `web/src/components/PregameUi.tsx:70-146`
- Modify: `web/src/App.tsx` (the setup panel's call site)
- Test: `web/src/components/__tests__/PregameUi.test.tsx`

**Interfaces:**
- Consumes: `GameConfig`, `clampGameConfig` from `@hidden/game-core`.
- Produces: the setup panel takes `config: GameConfig` and
  `onConfigChange: (patch: Partial<GameConfig>) => void`, replacing the three
  value props and three callbacks at lines 70-75.

Collapsing to one patch callback is the point of this task: the knob count goes
from three to nine, and one callback keeps the call site from growing with it.

- [ ] **Step 1: Write the failing test**

Append to `web/src/components/__tests__/PregameUi.test.tsx` (create it if
absent, following the import style of `BoardGrid.test.tsx` from Task 6):

```tsx
it('emits a board size patch when a size is chosen', () => {
  const patches: Partial<GameConfig>[] = []
  const { getByRole } = render(
    <SetupPanel
      config={DEFAULT_GAME_CONFIG}
      onConfigChange={(patch) => patches.push(patch)}
    />,
  )
  fireEvent.click(getByRole('button', { name: /5 x 5/i }))
  expect(patches).toContainEqual({ boardSize: 5 })
})

it('clamps the streak when the board shrinks', () => {
  const patches: Partial<GameConfig>[] = []
  const { getByRole } = render(
    <SetupPanel
      config={{ ...DEFAULT_GAME_CONFIG, boardSize: 5, streak: 5 }}
      onConfigChange={(patch) => patches.push(patch)}
    />,
  )
  fireEvent.click(getByRole('button', { name: /3 x 3/i }))
  expect(patches).toContainEqual({ boardSize: 3, streak: 3 })
})

it('emits a power-up master toggle', () => {
  const patches: Partial<GameConfig>[] = []
  const { getByRole } = render(
    <SetupPanel config={DEFAULT_GAME_CONFIG} onConfigChange={(p) => patches.push(p)} />,
  )
  fireEvent.click(getByRole('button', { name: /power-ups/i }))
  expect(patches).toContainEqual({ powerupsEnabled: false })
})
```

Replace `SetupPanel` with the actual exported component name at
`web/src/components/PregameUi.tsx:78`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "E:/Unity Projects/Hidden/web" && npx vitest run src/components/__tests__/PregameUi.test.tsx
```

Expected: FAIL. The component still takes `rounds` / `onRoundsChange`.

- [ ] **Step 3: Implement**

In `web/src/components/PregameUi.tsx`, replace the props block at lines 70-75:

```tsx
  config: GameConfig
  onConfigChange: (patch: Partial<GameConfig>) => void
```

Destructure `{ config, onConfigChange }` instead of the three values, and
replace `rounds` with `config.rounds`, `turnSeconds` with `config.turnSeconds`,
and `blindMode` with `config.blindMode` throughout. The three existing
callbacks become `onConfigChange({ rounds: next })` and so on.

Add these controls below the existing blind-mode toggle:

```tsx
      <label className="unity-field">
        <span>Board</span>
        <div className="unity-segmented">
          {([3, 4, 5] as const).map((size) => (
            <button
              key={size}
              type="button"
              className={`unity-toggle ${config.boardSize === size ? 'unity-toggle-on' : ''}`}
              aria-pressed={config.boardSize === size}
              onClick={() =>
                onConfigChange(
                  // A 5-streak is illegal on a 3x3, so shrink it with the board.
                  config.streak > size
                    ? { boardSize: size, streak: size }
                    : { boardSize: size },
                )
              }
            >
              {size} x {size}
            </button>
          ))}
        </div>
      </label>

      <label className="unity-field">
        <span>Line length</span>
        <input
          type="range"
          min={2}
          max={config.boardSize}
          value={config.streak}
          onChange={(event) => onConfigChange({ streak: Number(event.target.value) })}
        />
        <output>{config.streak} in a row unlocks a power-up</output>
      </label>

      <button
        type="button"
        className={`unity-toggle ${config.powerupsEnabled ? 'unity-toggle-on' : ''}`}
        aria-pressed={config.powerupsEnabled}
        onClick={() => onConfigChange({ powerupsEnabled: !config.powerupsEnabled })}
      >
        Power-ups
      </button>

      {config.powerupsEnabled ? (
        <div className="unity-field">
          <span>Enabled power-ups</span>
          {(['shield', 'reveal', 'extraTurn'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`unity-toggle ${config.powerups[key] ? 'unity-toggle-on' : ''}`}
              aria-pressed={config.powerups[key]}
              onClick={() =>
                onConfigChange({
                  powerups: { ...config.powerups, [key]: !config.powerups[key] },
                })
              }
            >
              {key}
            </button>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className={`unity-toggle ${config.forbidImmediateRepeat ? 'unity-toggle-on' : ''}`}
        aria-pressed={config.forbidImmediateRepeat}
        onClick={() =>
          onConfigChange({ forbidImmediateRepeat: !config.forbidImmediateRepeat })
        }
      >
        No repeat cell
      </button>
```

Update the rules summary at lines 144-146 to read from the config and append
the new facts:

```tsx
      <span>{config.boardSize} x {config.boardSize}</span>
      <span>{config.rounds} rounds</span>
      <span>{config.turnSeconds}s turns</span>
      <span>{config.blindMode ? 'Blind boards' : 'Open boards'}</span>
      <span>{config.powerupsEnabled ? 'Power-ups on' : 'Power-ups off'}</span>
```

In `web/src/App.tsx`, replace the three separate config state values with one
`GameConfig` initialised to `DEFAULT_GAME_CONFIG`, and pass:

```tsx
  onConfigChange={(patch) =>
    setConfig((current) => clampGameConfig({ ...current, ...patch }))
  }
```

Routing every change through `clampGameConfig` means the UI cannot produce an
invalid config, so the server clamp becomes a defence rather than the only
guard.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "E:/Unity Projects/Hidden/web" && npm test && npm run lint && npm run build
```

Expected: PASS, clean lint, clean build.

- [ ] **Step 5: Play a variant against the bot to confirm it works end to end**

```bash
cd "E:/Unity Projects/Hidden/web" && npm run dev
```

Open the app, choose offline practice, set the board to 5 x 5, line length 4,
power-ups off, rounds 20, and play a match. Confirm the board renders 25 cells,
no power-up ever unlocks, and the match ends with a cell-count result.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat(web): expose board, streak, and power-up knobs in setup"
```

---

### Task 8: Delete the mode registry and the compatibility shim

**Files:**
- Modify: `packages/game-core/src/index.ts`
- Modify: `packages/game-core/src/index.test.ts`
- Modify: `server/src/matchRules.ts`
- Test: all three packages

**Interfaces:**
- Consumes: nothing new.
- Produces: `ModeRef`, `ClassicMode`, `ClassicTopology`'s public export,
  `ModeRegistry`, `MODE_REGISTRY`, `CLASSIC_V1`, `MatchRules`,
  `DEFAULT_MATCH_RULES`, `decodeMatchRules`, and `clampMatchRules` are removed.
  `GameSpec` becomes `ResolvedGameSpec`.

Nothing outside `game-core` should still reference these after Tasks 4 and 5.
This task proves that by deleting them.

- [ ] **Step 1: Delete the legacy exports**

In `packages/game-core/src/index.ts`:

- Delete `MatchRules`, `DEFAULT_MATCH_RULES`, `decodeMatchRules`,
  `clampMatchRules`, `ModeRef`, `ModeRegistry`, `MODE_REGISTRY`, and
  `CLASSIC_V1`.
- Make `ClassicMode` and `ClassicTopology` non-exported internal types; only
  `buildMode` and `createTopology` construct them. Keep `ClassicTopology`
  exported if `createTopology`'s public return type requires it.
- Replace `GameSpec` and `resolveSpec` with a single non-optional spec:

```ts
export interface GameSpec {
  readonly engine: EngineRef
  readonly config: GameConfig
  readonly seed: number
  readonly firstSeat: Seat
}
```

  and change `createGame` to validate the engine inline and call
  `clampGameConfig(spec.config)` directly. Delete `ResolvedGameSpec` and use
  `GameSpec` for `GameState.spec`.

In `server/src/matchRules.ts`, delete the `MatchRules` re-exports, keeping only
the config helpers.

- [ ] **Step 2: Delete the tests that only covered the legacy shapes**

In `packages/game-core/src/index.test.ts`, delete the test
`'accepts a legacy mode+rules spec and produces the default game'` from Task 3
and any test importing `MODE_REGISTRY`, `CLASSIC_V1`, or `decodeMatchRules`.

Delete `server/src/matchRules.test.ts`'s `decodeMatchRules` and
`clampMatchRules` blocks, keeping the config blocks added in Task 4.

Do not delete the topology assertion from Task 1. It uses a literal, not
`CLASSIC_V1`, and is the guard that the 3x3 board is unchanged.

- [ ] **Step 3: Run everything**

```bash
cd "E:/Unity Projects/Hidden/packages/game-core" && npx vitest run
```

```bash
cd "E:/Unity Projects/Hidden/server" && npm test && npm run build
```

```bash
cd "E:/Unity Projects/Hidden/web" && npm test && npm run lint && npm run build
```

Expected: all PASS. Any compile error names a file still using a legacy export;
migrate it rather than restoring the export.

- [ ] **Step 4: Build the production container**

```bash
cd "E:/Unity Projects/Hidden" && docker build -t hidden:config-test .
```

Local Docker is known to be broken on this machine. If the build fails for an
environment reason rather than a code reason, run it on the Hetzner host
instead, per the project's preflight practice.

- [ ] **Step 5: Commit**

```bash
git add packages/game-core server/src
git commit -m "refactor(core): remove the mode registry and MatchRules"
```

---

## What this plan does not cover

Phases 2 and 3 of the spec get their own plans:

- **Lobby** — packets 21 to 26, the server's pending-game registry, and the
  create/join UI replacing the two `Coming soon` buttons.
- **Replay** — packet 27 `MATCH_RECORD`, `sessionStorage` history, the review
  screen, and branch-from-turn.

Simultaneous conflict resolution stays deferred, as recorded in the spec.

The spec's `PRESETS` export (named `GameConfig` values replacing
`MODE_REGISTRY`) is deliberately not built here. Nothing can select a preset
until the lobby exists, and `DEFAULT_GAME_CONFIG` already covers the only
preset that currently matters. It belongs in the lobby plan.
