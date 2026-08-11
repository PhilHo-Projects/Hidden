# Hidden roadmap

Last reviewed: 2026-08-11.

Hidden is in mechanics discovery, not feature accumulation. The next useful
change is the smallest one that helps answer whether a ruleset is more fun.
Completed work belongs in [JOURNAL.md](JOURNAL.md); operational instructions
belong in the root [README.md](../README.md).

## Current baseline

- The live game is a React client and one Node process. Active rooms,
  matchmaking, timers, and canonical match state are process-local, so
  production must remain at one replica.
- `@hidden/game-core` is a deterministic classic engine shared by offline play,
  the authoritative server, and the online client projection.
- `GameConfig` carries board size, streak length, rounds, turn seconds, blind
  mode, and power-up toggles. Offline practice exposes the knobs; a hosted game
  carries its host's clamped config end to end.
- Public and private lobbies, guest play, accounts, ready/rematch, authoritative
  commands, power-ups, disconnect cleanup, and offline bot play work.
- PostgreSQL stores accounts, sessions, and final snapshots for completed online
  matches. It does not store active rooms or replay command streams.
- Signed-in participants have private history and bookmarks. Configured admins
  have a read-only workbench for runtime counts, stored snapshots, and account
  aggregates.

## Non-negotiable contracts

- Never change a published engine revision in place. Resolution, scoring, or RNG
  changes require a new revision; ordinary config values travel with the match.
- Numeric packet IDs are frozen. Append new IDs rather than renumbering active
  ones, and always derive sender identity and seat from the connection.
- Static history is evidence of how a match ended, not executable replay.
- Do not raise the production replica count until matchmaking and active match
  state are shared and reconnect has been designed.

## Next phase: playtest and balance

Use practice configs, hosted matches, and final snapshots to test rules quickly.
Record the config and observed outcome for each useful session. Prefer config
experiments over engine changes while the classic turn model is still being
evaluated.

Questions worth testing include board density, round count, power-up pacing,
blindness, comeback potential, and whether desecration sufficiently interrupts
repeated-cell loops. A variant earns permanent UI or backend work only after it
shows value in real games.

### Simultaneous conflict resolution

Conflicts currently resolve when a placement arrives, so contesting a cell
reveals information immediately. Desecration prevents an immediate re-attack
for one owner turn but does not remove that information leak.

Buffering placements and resolving them together is the principled fix, but it
changes turn flow and interacts with extra turns, shields, timeouts, and command
delivery. Build it only if playtesting shows the remaining leak is materially
hurting the game.

### Alternate timing models

A non-turn-based mode is a valid future design track, but it is not another
`GameConfig` toggle. The current core and `MatchCoordinator` assume an active
seat, per-turn deadlines, timeout commands, and extra-turn buffering.

Such a mode can reuse authenticated connections, rate limits, lobbies,
authoritative state ownership, revisioned commands, and persistence boundaries.
It still needs its own engine/lifecycle contract and protocol design. Do not
stretch the published classic engine revision to contain incompatible timing
semantics.

## Later platform work

- **Reconnect and active-match durability:** resumable membership, canonical
  timers, command state, and restart recovery. Completed-match history does not
  provide any of these.
- **Horizontal scaling:** shared matchmaking and match ownership first; raising
  the single-process connection cap is the cheaper interim option.
- **Action replay:** only after mechanics stabilize. A versioned timeline must
  include ordered player actions and server-generated timeouts because timeouts
  consume seeded RNG.
- **Admin research tools:** shared collections, annotations, guarded retention,
  and storage reporting may extend the read-only boundary later.
- **Irregular boards:** square 3x3-5x5 topologies are sufficient until a square
  variant proves fun.

## Remaining codebase debt

- `web/src/assets/textures/button-splash.png` is 412 KB and remains the only
  asset-weight cleanup worth prioritizing. Convert it without changing its
  appearance, but not as part of the stylesheet split.
- Tailwind currently supplies the reset beneath the authored CSS. Removing it
  saves little and risks the box model; leave it in place.
- `immune` and packet `IMMUNE_UPDATE` are established engine/protocol vocabulary.
  Renaming them for presentation would create protocol churn without gameplay
  value.
- `hidden-board-interactive`, `hidden-cell-occupied`, and
  `hidden-cell-hidden` are harmless markup hooks with no CSS consumers. They are
  recorded here so they are not repeatedly rediscovered as defects.
