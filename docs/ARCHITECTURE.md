# Hidden — the guided tour

Written for someone who just joined and has never seen this repo. It answers
three questions: **where is everything**, **do the names still mean what they
say**, and **how does the multiplayer actually work**.

If you only read one other file, read [ROADMAP.md](ROADMAP.md) — this file tells
you how the machine is built, that one tells you what to do next.

Last reviewed: 2026-08-06.

---

## 1. The 60-second version

Hidden is a two-player blind-board game. You and your opponent each have your
own grid. You cannot see theirs. You place a rock/paper/scissors symbol on a
cell; if they have also played that cell, RPS decides whose piece is destroyed.
Most surviving cells at the end wins. Power-ups (shield / reveal / extra turn)
unlock by completing a line of matching symbols on your own board.

Technically it is three TypeScript packages in one npm workspace:

```
packages/game-core  ← the rules. Pure, deterministic, no I/O, no React, no network.
server/             ← Express + ws. Owns the authoritative match. Imports game-core.
web/                ← React 19 + Vite. Renders it. Imports game-core too.
```

The critical design decision: **the client and the server run the exact same
engine code.** The server is the authority, but the client is not a dumb
terminal — it replays every authoritative command locally and checks that it got
the same answer. If it doesn't, the match stops. More on that in §5.

---

## 2. Folder structure

### Top level

| Path | What it is | Verdict |
| --- | --- | --- |
| `packages/game-core/` | The rules engine. One 753-line `index.ts`. | Good. |
| `server/` | Node service: HTTP, WebSocket, matchmaking, auth. | Good. |
| `web/` | React client. | Good, but `index.css` and `App.tsx` are too big — see below. |
| `docs/` | ROADMAP, JOURNAL, and `superpowers/{plans,specs}`. | Good. Read `docs/README.md` first; it tells you what *not* to read. |
| `art/` | Non-shipping concept art scratch space. Explicitly excluded from the Docker build. | Good, and well documented in `art/README.md`. |
| `scripts/` | One script, `verify-lockfile-platforms.cjs`, wired into `npm test`. | Fine. |
| `Dockerfile` | Multi-stage Node 24 build → one container serving app + WebSocket on 8080. | Good. |
| `CLAUDE.md` / `AGENTS.md` | Contributor rules. One document, two files — Claude Code reads the first, Codex the second, and each sees only its own. `npm test` fails if they diverge. | Fine. Edit both. |
| `DESIGN.md` | Visual/UX rules (typography, hierarchy, phone-first). | Good — this is the style bible, not decoration. |

### Inside `web/src/`

```
App.tsx              1562 lines. The whole app: state, screens, socket wiring, render.
index.css            2680 lines. All styling, one file.
main.tsx             Entry point.
game/                Client-side game logic (see below).
components/          BoardGrid, PowerupTray, PregameUi, ProfileMenu, AccountForm,
                     RuleControls, HowToPlayModal, ruleSchema.ts
animations/          One CSS file per effect + CartoonBurst.tsx.
auth/                authClient.ts (fetch wrapper), accountValidation.ts
assets/              fonts/ icons/ textures/ backgrounds/
```

`web/src/game/` is where the interesting client code lives:

| File | Role |
| --- | --- |
| `protocol.ts` | Encode/decode MessagePack packets. Strict validation of everything inbound. |
| `networkClient.ts` | WebSocket lifecycle → emits typed `ClientEvent`s. |
| `onlineAuthority.ts` | **The heart of online play.** Mirrors the server's match state and verifies it. |
| `coreAdapter.ts` | Translates core `GameState` → the shape React renders. Also drives offline play. |
| `onlineMatch.ts` | Small helpers: countdown steps, config merge, terminal-screen guards. |
| `viewModel.ts` | Screen enum, back-navigation map, display-string helpers. |
| `types.ts` | The *presentation* types (`GameState`, `MatchConfig`, `EngineEvent`). |
| `constants.ts` | Colors + power-up labels. Partly dead — see §4. |
| `engine.ts` | **Legacy. ~530 of its 535 lines are dead.** See §6. |

### Structural verdict

The three-package split is genuinely good and it is the thing holding the
project together. Rules live in exactly one place, so client and server cannot
disagree about what the game is.

Two real complaints:

1. **`App.tsx` at 1562 lines is doing five jobs**: screen routing, socket
   wiring, auth flow, lobby flow, and the entire render tree. The pieces that
   were extractable have been extracted (`viewModel.ts`, `onlineMatch.ts`,
   `PregameUi.tsx`) — the remaining bulk is the render tree and ~25 `useState`
   calls. Splitting per screen is the obvious next move; nothing blocks it.
2. **`index.css` at 2680 lines is one file for the entire app.** It is unusually
   well-commented (~30 explanatory block comments explaining *why* a rule
   exists), so it is not chaos — but finding a rule means grepping.

Test file placement is inconsistent, three conventions in one package:

- `web/src/components/__tests__/*.test.ts`
- `web/src/game/__tests__/*.test.ts` — but also `web/src/game/coreAdapter.test.ts`,
  `onlineAuthority.test.ts`, `onlineMatch.test.ts` sitting next to their source
- `web/tests/*.test.ts` for whole-file assertions (fonts, asset URLs)

The server uses colocated `*.test.ts` throughout, which is cleaner. Worth
picking one convention for `web/` and moving the strays.

Test *runners* also differ: `game-core` uses bare `node --test`, `web` and
`server` use Vitest. That is deliberate (game-core has zero dependencies and
would like to keep it that way), but it means `npm test` at the root shells out
to two different runners.

Each package carries **two** TypeScript configs, and the split matters.
`tsconfig.json` builds and excludes `src/**/*.test.ts`, because without that
exclusion `npm run build` would compile the tests into `dist/` and ship them.
`tsconfig.test.json` extends it, sets `noEmit`, and puts the tests back, so they
are typechecked without being emitted. It runs as each package's `typecheck`
script, ahead of its suite.

That second config exists because for a long time it did not. Untypechecked
assertions rotted: `expect(rematch.run.spec.rules).toBe(...)` referred to a
property deleted with the mode registry, compared `undefined` to `undefined`,
and passed for months. If you add a package, give it both configs.

---

## 3. How the three packages fit together

```
                    ┌─────────────────────┐
                    │  @hidden/game-core  │
                    │                     │
                    │  createGame(spec)   │
                    │  applyCommand(...)  │
                    │  applyTimeout(...)  │
                    │  clampGameConfig()  │
                    │  ENGINE_REVISION    │
                    └──────────┬──────────┘
                               │  imported by both
                 ┌─────────────┴─────────────┐
                 ▼                           ▼
        ┌─────────────────┐         ┌─────────────────┐
        │     server/     │◄───ws──►│      web/       │
        │  the authority  │  msgpack│   the mirror    │
        └─────────────────┘         └─────────────────┘
```

**game-core is a pure function library.** Given `{ engine, config, seed,
firstSeat }` it produces a `GameState`. Every command returns a *new* state plus
a list of `DomainEvent`s. It has no dependencies, no I/O, no randomness beyond a
seeded mulberry32 PRNG carried inside the state itself.

That purity is what makes the whole architecture work: the same seed plus the
same ordered commands always produces the same game, on any machine.

Two exported constants carry the contract:

```ts
export const ENGINE_ID = 'classic'
export const ENGINE_REVISION = 1
```

**The one rule you must not break** (also stated in ROADMAP.md): never change how
a published engine revision resolves placements, scoring, or RNG without bumping
`ENGINE_REVISION`. Board size, round count, and toggles are *config* — they
travel with the match and are safe to change freely. Behaviour is *engine*.

### Rules are data

`GameConfig` holds every knob:

```ts
{ boardSize, streak, rounds, turnSeconds, blindMode,
  powerupsEnabled, powerups: {...}, powerupBySymbol: {...},
  forbidImmediateRepeat }
```

`clampGameConfig()` is deliberately **tolerant**: unknown fields are ignored,
each bad field falls back on its own rather than rejecting the whole object. An
older client degrades to the default game instead of failing to join.

It runs at four points — the UI on every knob change, the server on receipt, the
client on the start descriptor, and inside `createGame` — so an invalid config
cannot reach the engine from any direction.

Note `winningPatterns` (the line topology) is **not the win condition**. It only
triggers power-up unlocks. The win condition is "most surviving cells" in
`finishGame`. With power-ups off, lines do nothing.

---

## 4. Naming: what makes sense, what is a remnant

### The genuine Unity leftovers

This started life as a Unity project. Three artefacts survived the port:

1. **`unity-` CSS class prefix, everywhere.** `.unity-shell`, `.unity-board`,
   `.unity-cell`, `.unity-cell-occupied`, `.unity-cell-destroying-loss`…
   Also the CSS variables: `--unity-yellow`, `--unity-black`, `--unity-panel`,
   `--unity-white`, `--unity-muted`, `--unity-green/blue/red`.
   These have nothing to do with Unity. They are just the app's namespace now.
   Harmless, but genuinely confusing on day one, and two tests assert on the
   prefix (`AdvancedSettings.test.ts`, `BattleUi.test.ts`) so a rename is a real
   change, not a find-and-replace.

2. **`art/README.md`** describes itself by analogy to "the folder outside
   `Assets/` in a Unity project", and **`DESIGN.md`** opens by saying the game
   should feel game-like "without carrying Unity scene conventions into the
   browser." Both of these are *intentional* references, not rot. Leave them.

### The bigger naming problem: colors vs symbols

This one matters more than the Unity prefix, because it can actually mislead you.

The game is rock/paper/scissors. The **core** models that honestly:

```ts
type ClassicSymbol = 'rock' | 'paper' | 'scissors'
```

The **client** still models moves as *colors*, from an era when the pieces were
paint blobs:

```ts
export const COLOR_GREEN = '#A6E22E'   // = rock
export const COLOR_BLUE  = '#4591DB'   // = paper
export const COLOR_RED   = '#CC3941'   // = scissors
type PaintColor = '#A6E22E' | '#4591DB' | '#CC3941'
```

So `selectedColor`, `PaintColor`, and `CellState.color` all mean "which symbol",
and there are translation maps in **two separate places** — `symbolByColor` in
`App.tsx:90` and `colorBySymbol`/`symbolByColor` in `coreAdapter.ts:26-36`. The
wire protocol also still has color-based encoders (`encodeGameMovePacket` takes
a `PaintColor`), though nothing calls them outside tests.

This is the single most confusing thing in the client. The UI already shows rock
/paper/scissors icons and labels; the colors are now just theming. Collapsing
`PaintColor` into `ClassicSymbol` and keeping color as a pure style lookup would
delete a whole layer of translation.

### Smaller naming friction

- **Two things called `GameState`.** `web/src/game/types.ts` exports a
  presentation `GameState` (grids, announcements, `phase: 'setup' | 'battle' |
  'results'`). `@hidden/game-core` exports the canonical `GameState`. The
  presentation one carries the canonical one as `.canonicalState`, and
  `coreAdapter.ts` has to alias the import as `CoreGameState` to keep them
  apart. Not wrong, just something to be aware of before you trust an autocomplete.
- **`immune` means "shielded".** In the core, `LocationState.immune` and
  `handleImmunity()` are the shield power-up. The packet `IMMUNE_UPDATE` is from
  the same vocabulary. The player-facing word everywhere else is "shield".
- **`MatchConfig extends GameConfig`** and adds exactly `{ isOnline, hasAI }`.
  That split is clean and well commented — rules vs. how the match is being
  played. Keep it.
- **`hasAI`** means "offline practice bot". There is no AI; `applyTimeout()` with
  a seeded RNG plays the bot's turn. Accurate enough, mildly grand.

### What is named well

Worth saying explicitly, because most of it is: `DomainEvent`, `RejectionReason`,
`GameCommandEnvelope`, `AcceptedGameUpdate` / `RejectedGameUpdate`,
`MatchRun` vs `MatchRoom`, `TrustedMatchParticipant`, `OnlineAuthorityState`,
`ResolvedGameSpec`. These read exactly as they behave. The server-side naming in
particular is precise.

---

## 5. The networking stack — how it actually works

This is the part you asked about, so it gets the most room.

### 5.1 The shape of it

- **One process, one port (8080).** Express serves the compiled React app,
  answers `GET /healthz`, hosts `/api/auth/*`, and accepts WebSocket upgrades
  **only at `/ws`**. Any other upgrade path gets a 404.
- **Transport: raw `ws`, binary frames, MessagePack encoding.** Not Socket.IO,
  not JSON. Compression is off (keeps per-connection memory low).
- **All match state is in memory, in the process.** Matchmaking queue, pending
  lobby games, active matches, timers — all `Map`s on a `MatchCoordinator`
  instance. **This is why production must run exactly one replica.** A deploy or
  restart destroys every in-progress match. That is a known, accepted tradeoff
  (a match runs ~2 minutes); see ROADMAP items 3 and 4.
- **Accounts *are* persisted**, in PostgreSQL, via `server/migrations/`. Accounts
  are optional — guests get unrestricted online and offline play.

### 5.2 Packet format

Every packet is a MessagePack **array**, not an object:

```
[ senderId, packetType, ...payload ]
```

Packet types are numbers in a shared enum, duplicated in
`server/src/protocol.ts` and `web/src/game/protocol.ts`.

> **Rule from CLAUDE.md: numeric packet IDs are frozen.** You may rename a
> symbol; changing an active number is a protocol break. There is a test
> asserting the numbers.

> **Rule: `senderId` (slot 0) is never trusted.** The server ignores it entirely
> and uses the connection-assigned client ID. The client fills it in as a
> historical courtesy. Do not read it server-side.

The live set:

| # | Name | Direction | Meaning |
| --- | --- | --- | --- |
| 2 | `ID_ASSIGN` | → client | First packet on connect. Your authoritative client id. |
| 5 / 6 | `ROOM_JOIN` / `ROOM_LEAVE` | → server | Only `'lobby'` may be joined directly. |
| 8 | `SERVER_RESPONSE` | → client | `[success, originalPacketType]`. Resolves a pending request. |
| 9 | `USER_INFO` | both | Set your name / broadcast the name list. |
| 12 | `READY_STATE` | both | Ready up. Both ready → match starts. |
| 13 | `MATCHMAKING_REQUEST` | → server | Enter/leave the Quick Match queue. |
| 14 | `MATCH_FOUND` | → client | `[roomId, config]`. |
| 15 | `GAME_START` | → client | `[firstPlayerId, GameStartDescriptor]`. |
| 17 | `OPPONENT_DISCONNECTED` | → client | |
| 19 | `GAME_COMMAND` | → server | A move, wrapped in an envelope. |
| 20 | `GAME_UPDATE` | → client | Accepted or rejected. The only gameplay channel. |
| 21–27 | `LOBBY_*` | both | Create / created / list / join / cancel / subscribe / error. |

Numbers **10, 11, 18** (`GAME_MOVE`, `IMMUNE_UPDATE`, `GAME_MOVES`) are the old
pre-authoritative move packets. The server still parses them so it can reply
with an explicit `legacy-gameplay-disabled` rejection rather than dropping the
connection. Number **16** is an unused gap.

Numbers **0, 1, 3, 4, 7** (`CHAT`, `POSITION`, `TIME_SYNC`, `ROOM_CREATE`,
`ROOM_DESTROY`) exist only in the client enum. The server has never implemented
them. `TIME_SYNC` even has a decode branch and a no-op handler.

### 5.3 Connecting

```
browser                                  server
   │                                        │
   │──── WS upgrade GET /ws ───────────────►│  path must be /ws        → else 404
   │                                        │  Origin must be allowed  → else 403
   │                                        │  session cookie? look up account
   │                                        │  connection count < max? → else 503
   │◄─── [0, ID_ASSIGN, 7] ─────────────────│  you are client #7
   │                                        │
   │──── [7, USER_INFO, "Guest#0421"] ─────►│  guests MUST match /^Guest#\d{4}$/
   │◄─── [0, SERVER_RESPONSE, true, 9] ─────│  an account's name comes from the
   │                                        │  session and cannot be overridden
   │──── [7, ROOM_JOIN, "lobby"] ──────────►│
   │◄─── [0, SERVER_RESPONSE, true, 5] ─────│
```

`app.ts` handles the upgrade. Note the connection-limit check happens **twice**
for authenticated users — once before the async session lookup (counting
in-flight upgrades) and once after — because the DB round-trip is a window where
the count can change.

The client wraps request/response packets in promises with a **5-second
timeout**; `sendUserName()` and `joinRoom()` resolve or reject, everything else
is fire-and-forget.

### 5.4 Getting into a match — two paths, one destination

**Quick Match** (`MATCHMAKING_REQUEST`): you go into a queue. When the queue
reaches 2, the first two are pulled and a room is created. Config comes from
whichever of the two proposed one — and a proposal is **only honoured from an
admin account**; everyone else's proposed config is logged and ignored. The
reasoning is in the code: a Quick Match proposal binds a stranger.

**Private / public lobby** (`LOBBY_CREATE`): you host a game with a 5-character
join code drawn from an unambiguous alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`
— no O/0, no I/1, so a code read aloud is unambiguous). `isPrivate` decides
whether it appears in the public list. **Any player can host, guests included** —
you set the rules of a game you own. Subscribers to the list get a fresh
`LOBBY_LIST` on every change. If the host disconnects, the entry is cleared and
a new list is pushed so nobody sees an unjoinable game.

Both paths land in the same `createRoom()`, produce the same `MATCH_FOUND`, and
reuse the same ready/start flow. That's why adding the lobby didn't touch match
handling.

Guards worth knowing: hosting removes you from the Quick Match queue (otherwise
one connection could be pulled into two rooms), you can't join your own game,
and you can't host while already in a match.

### 5.5 The authoritative match cycle — the important part

Once both players send `READY_STATE(true)`, the server calls `startRun()`:

```ts
GameStartDescriptor {
  matchId,            // uuid
  engine,             // { id: 'classic', revision: 1 }
  config,             // the frozen, clamped GameConfig
  seed,               // random uint32
  firstSeat,          // 0 or 1
  revision: 0,
  turnTimeRemainingMs // turnSeconds * 1000 + 3000 grace
}
```

Both clients receive this and call `createGame(descriptor)` — **the same
function the server just called with the same arguments.** Both sides now hold
byte-identical state. This is `createOnlineAuthority()` in `onlineAuthority.ts`.

The `revision` is a simple integer that increments by one per applied command.
It is the sync anchor for everything that follows.

#### Sending a move

```
client                                                server
  │                                                      │
  │  queueOnlineCommand(state, command)                  │
  │    refuses if: not synchronized, a command is         │
  │    already pending, not your seat, or game over      │
  │                                                      │
  │──[GAME_COMMAND, {                                    │
  │     matchId, commandId: 3,                           │
  │     expectedRevision: 8,                             │
  │     command: {type:'place', locationId:4,            │
  │               symbol:'rock'} }]───────────────────►  │
  │                                                      │
  │            server checks, in order:                  │
  │              0. has the turn deadline already passed? │
  │                 if so, resolve the timeout FIRST      │
  │              1. do you have an active match?          │
  │              2. does matchId match?                   │
  │              3. is this an exact retry? → replay      │
  │                 the cached response                   │
  │              4. is the game finished?                 │
  │              5. is commandId reused with different    │
  │                 content? → reject                     │
  │              6. does expectedRevision == revision?    │
  │              7. applyCommand() — do the RULES allow it?│
  │                                                      │
  │◄─[GAME_UPDATE, {status:'accepted',                   │
  │     fromRevision:8, toRevision:9, actorSeat,          │
  │     commands:[...], events:[...],                     │
  │     turnTimeRemainingMs}]──────────────────────────  │
```

Only **one command may be in flight per client at a time**. That single
constraint removes most of the reordering complexity you'd otherwise need.

#### Receiving an update — the client does not trust it

`applyOnlineUpdate()` is the most important function in the client. It runs
**eight checks** before accepting anything, and any failure puts the match into
a terminal `sync-lost` state rather than continuing on a possibly-wrong board:

1. `matchId` matches.
2. `fromRevision` equals the client's current revision — nothing was missed.
3. `toRevision == fromRevision + commands.length` — the arithmetic is consistent.
4. If the update carries a `commandId`, it matches the pending command.
5. If it carries a `commandId`, `actorSeat` is the local seat.
6. If it carries a `commandId`, the echoed command deep-equals what was sent.
7. **Every command is replayed locally through `applyCommand`/`applyTimeout`,
   and the resulting events must deep-equal the server's events.** This is the
   real check. A rules divergence between client and server is caught here,
   immediately, instead of silently drifting.
8. The deadline field must agree with the replayed phase (active ⇒ a number,
   finished ⇒ null).

There is no rollback, no reconciliation, no prediction. The client applies
nothing locally until the server confirms it — `onlineInputPending` greys out
input while a command is in flight. Given a ~2-minute turn-based match, that's
the right call: the complexity budget went into *verification* instead of
*prediction*.

#### Turn timers

The server owns the clock. `resetPlacementWindow()` restarts a `setTimeout` for
`turnSeconds` after every accepted placement. The first deadline gets an extra
**3000 ms grace** (`MATCH_START_GRACE_MS`) to cover the client's 2.62-second
"3-2-1-GO" animation plus transport.

When a timer fires the server calls `applyTimeout()` — which **consumes the
seeded RNG** to pick a random cell and symbol — and broadcasts it as a normal
command. Two consequences:

- Timeouts are part of the command stream. Any future replay must include them
  with their acting seat, or reconstruction desynchronises. This is already
  flagged in ROADMAP item 1.
- Clients never send `timeout`. `encodeGameCommandPacket` throws if you try, and
  the server's decoder types `ClientGameCommand` as `Exclude<GameCommand,
  {type:'timeout'}>`.

There is also a **lazy deadline check**: before handling any incoming command,
the server checks whether the deadline already passed and resolves the timeout
first. So a command that raced the timer resolves in the correct order regardless
of `setTimeout` jitter.

#### The extra-turn buffer

One genuinely subtle piece. When a player has extra-turn active, the server
holds back the opponent's update (`bufferedOpponentUpdate`) until the extra turn
completes, then sends both placements as one multi-command update. Otherwise the
opponent would see the first placement land and learn that an extra turn was in
progress — an information leak in a blind-board game.

#### Disconnects

No reconnection. When a socket closes, `detachFromRoom()` cancels your queue
entry, clears any game you were hosting (and pushes a fresh lobby list), abandons
the room, and sends `OPPONENT_DISCONNECTED` to the other player. The room is
deleted. There is no way back into that match.

### 5.6 Accounts

Separate from the game protocol — plain HTTP under `/api/auth/*`:

- `POST /register`, `POST /login`, `POST /logout`, `GET /session`
- Session token in an **HttpOnly cookie**; the DB stores only a SHA-256 hash of
  it (`sessions.token_hash`, `bytea`, length-constrained to 32).
- Origin allowlist + `Content-Type: application/json` required on every POST.
- Rate limits: register 5/hour/IP; login 30/15min/IP **and** 10/15min/IP+username.
- Expired sessions swept every 6 hours.
- The WebSocket upgrade reads the same cookie. An authenticated connection's
  username comes from the session and cannot be overridden by a `USER_INFO`
  packet — only guests may set a name, and only in `Guest#NNNN` form.

Without `DATABASE_URL`, a non-production server logs `auth.disabled_guest_only`
and every account endpoint returns 503. Guest and offline play are unaffected.
This is the normal local-dev mode; you do not need Postgres to test two-tab
multiplayer.

### 5.7 Safety limits (all env-tunable)

| Guard | Default | Where |
| --- | --- | --- |
| Max connections | 100 | rejects upgrade with 503 |
| Messages/sec/connection | 30 | over → close 1008 |
| Max payload | 16 KiB | enforced by `ws` itself |
| Heartbeat | 30 s ping; no pong → terminate | |
| Response timeout | 5 s | client-side |
| Command cache | 128 entries/seat | bounded retry replay |
| Non-binary frame | close 1008 | text frames are never valid |
| Malformed packet | close 1008 | strict decode, no partial accept |

Logging is structured JSON. Per CLAUDE.md, **raw packet bodies must never be
logged at `info`** — packet contents go to `debug` only.

---

## 6. The cleanup punch list

Nothing here is on fire. This is the honest list of what a junior dev will trip
over, roughly in order of payoff.

**1. `web/src/game/engine.ts` is 535 lines of dead code.**
`App.tsx` imports exactly one function from it — `selectColor`, five lines that
clone state and set `selectedColor`. Everything else (`applyLocalMove`,
`applyRemoteMove`, `applyRemoteMoves`, `applyRemoteImmuneStatus`, `pickAiMove`,
`forceTimeoutAction`, `createInitialState`, `startMatch`, `activatePowerup`,
`applyShieldSelection`) is the pre-`game-core` engine and is called by nothing
but its own 227-line test file. It hardcodes a 3×3 board and color-based RPS
resolution — i.e. it is *wrong* for every non-3×3 config the app now supports.

Deleting it also frees:
- `WIN_LINES`, `POWERUP_BY_COLOR`, `POWERUP_MESSAGES` in `constants.ts` (used
  only by `engine.ts`)
- `web/src/game/__tests__/engine.test.ts`
- The `send-move` / `send-moves` / `send-immune` variants of `EngineEvent` in
  `types.ts` — emitted only by `engine.ts`, and `applyEngineResult` in `App.tsx`
  doesn't handle them at all
- `encodeGameMovePacket`, `encodeGameMovesPacket`, `encodeImmunePacket` in
  `protocol.ts` — referenced only by tests

Move `selectColor` into `coreAdapter.ts` and the whole layer goes.

**2. `PaintColor` → `ClassicSymbol` in the client.** The naming cleanup that
matters. Colors become styling; the symbol becomes the value. Removes a
duplicated translation map and a whole class of "wait, is green rock?" moments.

**3. Split `App.tsx`** (~1550 lines). Planned in detail in
[the open plan](superpowers/plans/2026-08-06-split-app-shell.md) — read that
before touching it, because the obvious approach is the wrong one. The render
tree is already fourteen screen blocks of at most 82 lines and is not the
problem; the 920-line hook body is.

**4. Split `index.css`** (2680 lines). Lower risk than `App.tsx` — CSS neither
typechecks nor breaks silently. Per-area files.

**5. The `unity-` CSS prefix.** Lowest priority — it's a namespace now and works
fine — but if you ever do a styling pass, renaming to `hidden-` costs one
find-and-replace across `index.css`, `App.tsx`, `BoardGrid.tsx`, and two test
files. Not worth a dedicated commit.

**6. Pick one test-file convention for `web/`.** Three are in use today:
`__tests__/`, colocated, and top-level `web/tests/`. The server uses colocated
throughout, which is cleaner.

Explicitly **not** on this list: the legacy packet IDs (10/11/18) and their
rejection path. Those are load-bearing — they make an old client fail loudly
instead of silently. Leave them.

---

## 7. Running it

No database needed for multiplayer testing.

```bash
npm ci
```

Terminal 1 — build and start the service on 8080:

```bash
cd server && npm run build && npm start
```

Terminal 2 — the Vite dev server on 5173, proxying `/api` and `/ws` to 8080:

```bash
cd web && npm run dev
```

Open **two browser tabs** on 5173. Both connect as guests, both can queue or
host, and you can play a full match against yourself. The server will log
`auth.disabled_guest_only` — that is expected without `DATABASE_URL`.

Verification gates:

```bash
npm test && npm run lint && npm run build
```

### Two traps that will cost you an hour each

**Blank page, clean console, React never mounts.** `@hidden/game-core` emits
CommonJS, and Vite leaves linked workspace packages unbundled — the dev server
cannot import CJS as ESM, and it fails *silently*. The fix is already in
`vite.config.ts` (`optimizeDeps.include: ['@hidden/game-core']`). If you ever see
a blank app with no error, check that line first. Production builds are
unaffected; Rollup handles CJS.

**Server rejects every packet as invalid.** Almost always a stale
`node dist/server.js` from an earlier build still holding port 8080. Kill it.

### One quirk worth knowing

`index.css` references assets as root-absolute `/src/assets/...` rather than
relative `./assets/...`. This is deliberate and locked by
`web/tests/assetPaths.test.ts`. Don't "fix" it to relative paths without reading
that test.

---

## 8. Where to go next

- [ROADMAP.md](ROADMAP.md) — current state and the next four things, in order.
  The near-term goal is **not shipping features**; it is being able to try rule
  variants cheaply until one is fun.
- [JOURNAL.md](JOURNAL.md) — what shipped and when, newest first. Short entries;
  the git log holds detail.
- [DESIGN.md](../DESIGN.md) — the visual and UX rules. Read before touching UI.
- [CLAUDE.md](../CLAUDE.md) / [AGENTS.md](../AGENTS.md) — the contributor rules.
  Read before touching runtime behaviour.
- `superpowers/specs/2026-08-03-game-mode-testbed-design.md` — why the rules
  engine is shaped the way it is.

`superpowers/plans/archive/` holds finished implementation scripts. They are long
and their work is already committed. Open one only to learn how a specific past
change was sequenced — never to find out what the project is.
