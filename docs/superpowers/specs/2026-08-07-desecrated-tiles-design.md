# Desecrated tiles

Date: 2026-08-07.

## The problem

Conflicts resolve at placement time, so a destroyed piece tells its owner what
the contested cell holds. Learning that is fine. Replaying the same cell on the
very next turn is not: the answer is still true, still cheap, and still there,
so both players trade the same coordinate turn after turn. Whoever moves last
converts a lead into a win without ever leaving the loop.

`forbidImmediateRepeat` was the first attempt. It defaults to `false`, is buried
behind an advanced toggle nobody enables, keys off *where you last placed*
rather than off destruction, and misses the second placement of an extra turn.

## The rule

A cell whose piece is destroyed becomes **desecrated** for its owner. It is
unplayable for exactly one of that owner's turns and reopens on the turn after.

This lands the same way whether the piece died on your turn or on theirs, so the
player who lost a cell must always spend a turn somewhere else before returning
to it. The information is unchanged; only the immediate re-attack is denied.

The rule is unconditional. There is no config flag, so quickmatch, created
games, private codes, and offline bot play all get it by construction.

### Scope is cosmetic, not mechanical

Locking only the loser and locking the coordinate on both boards produce
identical legality. A cell dies only through a conflict, and after a conflict
the other seat either still holds a surviving piece there — occupied, so
unplayable anyway — or was destroyed too and is locked on its own account. The
choice is only about what the brown tile means to a reader.

### What this does not fix

Conflicts still resolve at placement time, so contesting a cell still reveals
instantly that it was contested. This narrows the exploit; it does not remove
the leak. Simultaneous conflict resolution stays the principled fix, and stays
open in the roadmap.

## Engine

`packages/game-core/src/index.ts`.

- `LocationState` gains `desecratedTurns: number`, where `0` means playable.
- A `cell-destroyed` for seat S at location L sets `desecratedTurns = 2` on S's
  board at L.
- `beginTurn(state, seat)` decrements every positive counter on that seat's
  board by one. It runs wherever `activeSeat` is assigned: in `consumeTurn` and
  inside the `resolveAutomaticPasses` loop.
- `place` rejects a positive counter with a new `'desecrated-location'` reason.
- `hasLegalPlacement` and the `available` filter in `applyTimeout` both become
  `symbol === null && desecratedTurns === 0`.

### Why the counter starts at 2

Destruction happens during a turn, after that turn's decrement has already run.
Starting at 2 means the owner's next turn decrements 2 to 1 and stays locked,
and the turn after decrements 1 to 0 and reopens. Starting at 1 would reopen the
cell a full turn early whenever the piece died on its owner's own turn.

An extra turn is one turn start and therefore one decrement, so a cell
desecrated by the first placement is still locked for the second.

### Two bugs this closes

Both are reachable today with `forbidImmediateRepeat` enabled, and both become
the common path once the rule is always on.

- `applyTimeout` picks a random empty cell with no awareness of the rule. It can
  pick a locked one, `place` rejects, and `applyTimeout` still returns
  `accepted: true` with the turn never consumed.
- `hasLegalPlacement` only checks `symbol === null`, so a seat whose only empty
  cells are locked never auto-passes and cannot move.

Auto-pass terminates because the counters decay on every turn start, and
`turnCount >= maxTurns` ends the game regardless.

### Removed

`forbidImmediateRepeat` is strictly superseded: the config field, its clamp
branch, its default, its entry in `matchesRawConfig`, and the "No repeat" chip
in `ruleSchema.ts`. `GameState.lastPlacedLocation` and its clone and write go
with it, as do the `'repeat-location'` reason and its message.

### Engine revision

`ENGINE_REVISION` goes from 1 to 2. Placement resolution changes, and the
roadmap's one unbreakable rule is that a published revision is never edited in
place. `ClassicMode.revision` is currently the literal `1` and becomes
`typeof ENGINE_REVISION` so later bumps are free.

`decodeStartDescriptor` hard-gates on the revision, so a deploy invalidates
in-flight matches. Every deploy already does that, and nothing about matches
persists.

### Protocol

Unchanged. Board state never goes on the wire — both sides replay commands
through the same core and derive the view — so a new `LocationState` field costs
nothing in packets. `matchesRawConfig` already tolerates absent keys, so
dropping the old flag from its list is a plain removal.

## Presentation

Three layers, three names, chosen so the look can be replaced without touching
TypeScript.

| Layer | Name |
| --- | --- |
| Engine | `LocationState.desecratedTurns` |
| View | `CellState.desecrated` |
| CSS | `.hidden-cell-desecrated`, `--cell-desecrated-fill`, `animations/cell-desecration.css` |

`presentGrid` maps the counter to the boolean. `cellTone` returns
`var(--cell-desecrated-fill)` for a desecrated empty cell. The token resolves
from a new `--hidden-brown` palette entry beside the existing `--hidden-*`
colours.

The new stylesheet follows the established per-effect convention and BEM style
of `cell-destruction.css` and `score-count.css`.

**Upgrading the look is one token and one file.** Because `cellTone` feeds the
`background` shorthand, a gradient, an `image-set()`, or a texture `url()` all
drop into `--cell-desecrated-fill` unchanged.

### Motion

Deliberately thin. A `transition` on the cell background browns the tile in
after the destruction burst and fades it back out on release, plus one
`cell-desecration-settle` keyframe that fires when the class is added.

This needs no new domain event: the release rides the same transition in
reverse. A distinct release effect would need a `cell-released` event from the
engine, because removing a class cannot trigger an animation. That is the known
upgrade path and is deliberately not built now.

## Tests

Written before the behaviour, per the repository's change discipline.

- The lock spans exactly one owner turn when the piece died on its owner's turn.
- The lock spans exactly one owner turn when it died on the opponent's turn.
- The cell reopens on the following turn.
- The second placement of an extra turn respects a lock created by the first.
- A timeout never selects a desecrated cell.
- A timeout passes, consuming the turn, when only desecrated cells remain.
- Auto-pass terminates when a seat has only desecrated cells.
- Replay stays deterministic from seed plus commands.
