/**
 * The rules a match is played under, and the primitives every other module
 * needs to describe one.
 *
 * Lowest module in the package: it imports nothing. `topology.ts` reads
 * `BoardSize` and `GameConfig` from here, and the reducer in `index.ts` reads
 * both. Keeping the edge pointing one way is what stops a circular import
 * between a config that clamps a board size and a topology built from it.
 */

export type Seat = 0 | 1
export type LocationId = number
export type ClassicSymbol = 'rock' | 'paper' | 'scissors'
export type PowerupKey = 'shield' | 'reveal' | 'extraTurn'

function finiteNumberOrDefault(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export const ENGINE_ID = 'classic' as const
// Revision 2 added desecrated tiles, which changes placement resolution. A
// published revision is never edited in place: a stored match reconstructs from
// revision + config + seed + commands, so resolution changes must bump this.
export const ENGINE_REVISION = 2 as const

/*
 * Lives here because this is the lowest module and both of the others freeze
 * something. Internal: `index.ts` uses it and deliberately does not publish it,
 * because it is a helper rather than protocol.
 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child)
    }
  }
  return value
}

export type BoardSize = 3 | 4 | 5

/**
 * Which game this config describes. `main` is the shipped 3x3 game; `prototype`
 * is the cube experiment, which is deliberately incomplete and declares no
 * winner. Both names are placeholders.
 *
 * A union rather than a subclass hierarchy on purpose: `GameState` crosses
 * MessagePack and is cloned on every command, so behaviour has to be a pure
 * function of data rather than a method on it. The compiler's exhaustiveness
 * check on a `switch` is also what stops a new variant from silently
 * inheriting `main`'s behaviour.
 */
export type GameVariant = 'main' | 'prototype'

const GAME_VARIANTS: readonly GameVariant[] = ['main', 'prototype']

/** The cube is six 3x3 faces, so a prototype face is never any other size. */
export const PROTOTYPE_BOARD_SIZE = 3 as const

/** Double `main`'s default, because a cube match has more board to cover. */
export const PROTOTYPE_ROUNDS = 12 as const

export interface EngineRef {
  readonly id: typeof ENGINE_ID
  readonly revision: number
}

export interface GameConfig {
  readonly variant: GameVariant
  readonly boardSize: BoardSize
  readonly streak: number
  readonly rounds: number
  readonly turnSeconds: number
  /**
   * How long the reveal snapshot stays up. The core has no clock and never
   * expires it itself; this is the length the authority arms its timer for.
   */
  readonly revealSeconds: number
  readonly blindMode: boolean
  readonly powerupsEnabled: boolean
  readonly powerups: Readonly<Record<PowerupKey, boolean>>
  readonly powerupBySymbol: Readonly<Record<ClassicSymbol, PowerupKey>>
}

export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = deepFreeze({
  variant: 'main',
  boardSize: 3,
  streak: 3,
  rounds: 6,
  turnSeconds: 10,
  revealSeconds: 1.5,
  blindMode: true,
  powerupsEnabled: true,
  powerups: { shield: true, reveal: true, extraTurn: true },
  powerupBySymbol: { rock: 'shield', paper: 'reveal', scissors: 'extraTurn' },
}) as Readonly<GameConfig>

const BOARD_SIZES: readonly BoardSize[] = [3, 4, 5]
const SYMBOLS: readonly ClassicSymbol[] = ['rock', 'paper', 'scissors']
const POWERUP_KEYS: readonly PowerupKey[] = ['shield', 'reveal', 'extraTurn']

/**
 * Sub-second turns exist so an offline match against the bot can be replayed to
 * its outcome in seconds. Online keeps a floor of two seconds, because a human
 * has to read the board and press something.
 */
export const MIN_TURN_SECONDS = 0.2
export const ONLINE_MIN_TURN_SECONDS = 2
export const MAX_TURN_SECONDS = 60

/**
 * The snapshot is meant to be memorised, not read at leisure, so the ceiling is
 * low. The floor exists for the same reason `MIN_TURN_SECONDS` does: a test
 * driving a match to its outcome should not spend real seconds waiting for a
 * window to close.
 */
export const MIN_REVEAL_SECONDS = 0.1
export const MAX_REVEAL_SECONDS = 10

function clampInteger(value: unknown, min: number, max: number, fallback: number) {
  const numeric = finiteNumberOrDefault(value, fallback)
  return Math.min(max, Math.max(min, Math.trunc(numeric)))
}

// One decimal place. Anything finer is noise against render and network timing,
// and keeping it coarse stops float drift from reaching the wire.
function clampSeconds(value: unknown, min: number, max: number, fallback: number) {
  const numeric = finiteNumberOrDefault(value, fallback)
  const bounded = Math.min(max, Math.max(min, numeric))
  return Math.round(bounded * 10) / 10
}

function clampTurnSeconds(value: unknown, min: number) {
  return clampSeconds(value, min, MAX_TURN_SECONDS, DEFAULT_GAME_CONFIG.turnSeconds)
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

  const variant: GameVariant = GAME_VARIANTS.includes(
    candidate.variant as GameVariant,
  )
    ? (candidate.variant as GameVariant)
    : DEFAULT_GAME_CONFIG.variant

  const requestedSize = clampInteger(
    candidate.boardSize,
    3,
    5,
    DEFAULT_GAME_CONFIG.boardSize,
  )
  /*
   * A prototype face is always 3x3. This is a constraint rather than a default:
   * a host who asks for 5x5 in this variant is asking for something that does
   * not exist, so it is corrected rather than honoured.
   */
  const boardSize = (
    variant === 'prototype'
      ? PROTOTYPE_BOARD_SIZE
      : BOARD_SIZES.includes(requestedSize as BoardSize)
        ? requestedSize
        : DEFAULT_GAME_CONFIG.boardSize
  ) as BoardSize

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
    variant,
    boardSize,
    /*
     * Defaults to a full line for the board. `streak` is no longer a rule the
     * player sets: it only ever controlled how long a line must be to unlock a
     * power-up, never how a match is won, and a control labelled "line to win"
     * that did neither was worse than no control. The field stays configurable
     * because the topology is built from it and a stored match replays with the
     * config it was played under. Revisit when power-up unlocking is redesigned.
     */
    streak: clampInteger(candidate.streak, 2, boardSize, boardSize),
    rounds: clampInteger(candidate.rounds, 1, 20, DEFAULT_GAME_CONFIG.rounds),
    turnSeconds: clampTurnSeconds(candidate.turnSeconds, MIN_TURN_SECONDS),
    revealSeconds: clampSeconds(
      candidate.revealSeconds,
      MIN_REVEAL_SECONDS,
      MAX_REVEAL_SECONDS,
      DEFAULT_GAME_CONFIG.revealSeconds,
    ),
    blindMode: booleanOrDefault(candidate.blindMode, DEFAULT_GAME_CONFIG.blindMode),
    powerupsEnabled: booleanOrDefault(
      candidate.powerupsEnabled,
      DEFAULT_GAME_CONFIG.powerupsEnabled,
    ),
    powerups,
    powerupBySymbol,
  }
}

/**
 * The starting rules for a variant, used when the player switches modes.
 *
 * Separate from `clampGameConfig` deliberately. The clamp is tolerant and
 * cannot tell "the host chose 6 rounds" from "rounds were missing", so making
 * it apply per-variant defaults would let it silently overwrite a deliberate
 * choice. Defaults belong to the moment a mode is picked; the clamp only ever
 * validates.
 *
 * The `switch` returns in every arm and has no `default`, which is what makes
 * adding a third variant a compile error here until it is handled.
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

/**
 * The clamp an online match must use. Sub-second turns are an offline
 * iteration tool, so the server applies this to every proposed config rather
 * than trusting a client to have limited itself.
 */
export function clampOnlineGameConfig(value: unknown): GameConfig {
  const config = clampGameConfig(value)
  if (config.turnSeconds >= ONLINE_MIN_TURN_SECONDS) return config
  return { ...config, turnSeconds: ONLINE_MIN_TURN_SECONDS }
}

export function decodeGameConfig(value: unknown): GameConfig | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  return clampGameConfig(value)
}
