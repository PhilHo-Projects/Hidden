# Game mode testbed design

Date: 2026-08-03

## Purpose

Hidden is not yet a finished game, and its rules are not yet known to be good.
The 3x3 board has at least one degenerate loop: both players repeatedly contest
the same cell, and whoever resolves it last keeps it. Whether the fix is a small
rule change, a larger board, or removing power-ups entirely is unknown.

This work does not fix the game. It builds the instrument used to find the fix:
a host configures a variant, a second player joins it, and both can review what
happened afterward and play out alternatives. The intended loop is to run many
short experiments cheaply until a configuration is worth keeping.

Non-goals: durable match storage, reconnect, horizontal scaling, new win
conditions, non-square or irregular topologies.

## Replay integrity, and why the mode registry is replaced

A match is reconstructable from the engine, the rules, the seed, and the ordered
command stream. Today the rules are reached indirectly: the match stores
`mode: { id: 'classic', revision: 1 }`, and replay looks that key up in
`MODE_REGISTRY`.

That indirection is only sound while `classic@1` is never edited. Changing the
win lines in `packages/game-core/src/index.ts` would cause every stored replay
tagged `classic@1` to reconstruct into a different game than the one played,
silently and without error. The registry therefore requires that each variant be
published as a new immutable entry, which makes every experiment cost a code
change, a test update, and a deployment.

Storing the configuration on the match instead removes the indirection. A match
carries its own rules verbatim, so no later edit can alter it. This is a
stronger guarantee than the registry provides, and it makes variants free.

Versioning moves to the engine, which is the part that is genuinely code:
placement resolution, scoring, power-up mechanics, and the RNG. The engine
revision is bumped when that logic changes, which is rare. A replay whose engine
revision does not match the running engine is rejected rather than silently
reinterpreted.

## Architecture

### Engine identity

`game-core` exports `ENGINE_ID = 'classic'` and `ENGINE_REVISION = 1`.
`ModeRef`, `ClassicMode`, and `ModeRegistry` are removed.

`GameSpec` becomes `{ engine: { id, revision }, config, seed, firstSeat }`.
`createGame(spec)` no longer takes a registry argument and no longer performs a
lookup; it derives the internal mode from `spec.config` and throws if
`spec.engine.revision` is not the running revision.

### GameConfig

`GameConfig` replaces `MatchRules` rather than sitting beside it, so there is one
object, one decoder, and one clamp function covering every knob.

| Field | Type | Notes |
| --- | --- | --- |
| `boardSize` | `3 \| 4 \| 5` | Square boards only |
| `streak` | `number` | Line length that unlocks a power-up; clamped to `2..boardSize` |
| `rounds` | `number` | Clamped `1..20`, unchanged |
| `turnSeconds` | `number` | Clamped `2..60`, unchanged |
| `blindMode` | `boolean` | Unchanged |
| `powerupsEnabled` | `boolean` | Master switch |
| `powerups` | `Record<PowerupKey, boolean>` | Individual toggles |
| `powerupBySymbol` | `Record<ClassicSymbol, PowerupKey>` | Which symbol unlocks which |
| `forbidImmediateRepeat` | `boolean` | Bars a seat from replaying its own previous location |

`decodeGameConfig` is tolerant: unknown fields are ignored and missing fields
fall back to defaults, so a stale client degrades to the default configuration
rather than failing to join. `clampGameConfig` bounds every numeric field and
coerces every boolean.

`DEFAULT_GAME_CONFIG` reproduces today's game exactly: `boardSize: 3`,
`streak: 3`, `rounds: 6`, `turnSeconds: 10`, `blindMode: true`, power-ups on,
`forbidImmediateRepeat: false`.

### Topology generation

`createTopology(boardSize, streak)` returns `{ locationIds, winningPatterns }`.
`locationIds` is `0..boardSize^2 - 1`. `winningPatterns` is every horizontal,
vertical, and diagonal window of exactly `streak` cells.

`winningPatterns` is the power-up unlock trigger only. The win condition is
unchanged and lives in `finishGame`: the player with more surviving cells wins.
With power-ups disabled, `winningPatterns` has no effect on play.

A test asserts that `createTopology(3, 3)` deep-equals a literal copy of today's
hardcoded 3x3 topology, including pattern order, so this change provably does
not alter the existing game. The literal is written into the test rather than
imported, so it survives the removal of `CLASSIC_V1`.

### Presets

`MODE_REGISTRY` becomes `PRESETS`, a record of named `GameConfig` values rather
than code-defined modes. `CLASSIC_V1` becomes the `classic` preset. Promoting a
configuration that plays well is then a matter of naming it, not writing code.

### Rule behaviour

- `powerupsEnabled: false` causes `maybeUnlockPowerup` to return immediately and
  `activate-powerup` to reject with `powerup-locked`. Lines still form; they do
  nothing.
- A power-up disabled individually never unlocks, and lines of the symbol mapped
  to it are inert.
- `forbidImmediateRepeat` adds `lastPlacedLocation: readonly [LocationId | null,
  LocationId | null]` to `GameState` and a `repeat-location` rejection reason. A
  `place` command targeting the same location that seat played on its previous
  turn is rejected. The field updates on every accepted placement, including
  those made by `applyTimeout`.

### Client rendering

`.unity-board-grid` currently hardcodes `grid-template-columns: repeat(3, ...)`
in two places in `web/src/index.css`. Both become
`repeat(var(--board-size, 3), minmax(0, 1fr))`, with `--board-size` set inline
from the active configuration.

## Lobby

`createRoom()` already accepts two participants and is agnostic about how they
were matched, so match handling is unchanged. The new surface is only the
waiting state that exists before a room can be created.

The server holds `pendingGames`, a map keyed by join code:

```
{ code, hostClientId, hostName, config, isPrivate, createdAt }
```

The public list is a filtered read over that same map, so the list and the code
path are one feature rather than two. Joining removes the entry and calls
`createRoom(host, joiner, config)`. Host disconnection removes the entry and
pushes an updated list.

Clients on the lobby screen subscribe and receive the full public list on
subscribe and again on any change. Given the expected number of concurrent
lobbies, sending the whole list is simpler than diffing and is not a concern.

The host sets the configuration. There is no negotiation, which removes the
"first queuer's proposal" ambiguity that Quick Match currently has.

Client UI replaces the two `Coming soon` buttons. Create shows the configuration
form and a `Private (require code)` checkbox; when checked, the generated code is
displayed for the host to share. Join shows the public list with each entry's
configuration summary, plus a field for entering a code directly.

### Packet IDs

The highest active ID is `GAME_UPDATE = 20`. New packets are appended from 21.
No active ID is renumbered.

- `21 LOBBY_SUBSCRIBE`
- `22 LOBBY_LIST`
- `23 LOBBY_CREATE`
- `24 LOBBY_CREATED`
- `25 LOBBY_JOIN`
- `26 LOBBY_CANCEL`
- `27 MATCH_RECORD`

## Replay

On match completion the server sends `MATCH_RECORD`:

```
{ matchId, engineRevision, config, seed, firstSeat, commands, result }
```

`commands` is the ordered list of every command applied, each tagged with its
acting seat, including server-generated `timeout` commands. Timeouts are
required in the log because `applyTimeout` consumes the seeded RNG through
`choose`; omitting them would desynchronise reconstruction.

The record contains both seats' commands. The match is over, so blind mode no
longer applies, and both players receive identical complete records.

The client keeps the most recent 20 records in `sessionStorage`. There is no
database work, no schema, and no guest identity work. Records are lost on
deploy and on closing the tab, which is acceptable and intended: the current
purpose of history is reviewing games played minutes earlier in the same
session. Durable history is deferred until the game's rules are settled.

The review screen reconstructs the match by replaying the commands through the
same deterministic core, with both boards fully revealed and blind mode ignored.
Stepping forward and back moves through the reconstructed states.

"Try from here" takes the reconstructed state at the selected turn and hands it
to the offline practice path. Play continues with `applyCommand` against that
state, so hypotheticals are played out rather than discussed. No new engine code
is required.

A record whose `engineRevision` does not match the running engine is shown as
unplayable rather than reconstructed.

## Testing

`packages/game-core`:

- `createTopology(3, 3)` deep-equals the current hardcoded topology.
- Topology generation for 4x4 and 5x5 at several streak lengths.
- Power-ups disabled: no unlock events, `activate-powerup` rejected.
- Individual power-up toggles.
- `forbidImmediateRepeat` rejects a repeat and permits the same location later.
- `decodeGameConfig` and `clampGameConfig` round-trips, including missing and
  malformed fields.
- Determinism: identical seed, config, and command list produce an identical
  final state.

`server`:

- Lobby create, public listing, private omission from the list, join by code,
  join by list entry, cancel, and host disconnect.
- Configuration reaches the created room intact.
- `MATCH_RECORD` contains every applied command, including timeouts, in order.

`web`:

- Reconstructing a record reproduces the server's final state.
- Branching at turn N yields a valid state that diverges from the record.
- Board grid renders at each supported size.

## Sequencing

1. **Core configuration.** Topology generation, rule toggles, config decode and
   clamp, CSS, and the configuration form wired into offline practice. Variants
   become testable solo against the bot at the end of this step.
2. **Lobby.** Packets, server pending-game registry, create and join UI.
3. **Replay.** `MATCH_RECORD`, review screen, branch-from-turn.

## Deferred: simultaneous resolution

Conflicts currently resolve at placement time. Because of that, placing on a
contested cell immediately reveals that it was contested, which is the
information leak the known exploit depends on. Buffering both placements and
resolving at round end is the principled fix.

It is deferred because it restructures turn flow and interacts with `extraTurn`
and shield timing, making it comparable in size to the three steps above
combined. `forbidImmediateRepeat` is a cheap partial mitigation. The correct
order is to ship steps 1 to 3, play real games, and decide whether the loop
survives before rebuilding turn resolution.
