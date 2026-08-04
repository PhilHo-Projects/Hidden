# Private Lobby Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any player — guest included — host a game with their own
`GameConfig`, have it appear in a lobby list (or be reachable by code), and have
a second player join it and play those exact rules.

**Architecture:** `createRoom()` already takes two participants and is agnostic
about how they met, so match handling does not change. The new surface is the
waiting state before a room exists: a `pendingGames` map keyed by join code. The
public list is a filtered read over that same map, so the list and the code path
are one feature. Carrying `GameConfig` through the server (previously "Task 4"
of the parameterization plan) is folded in here, because a lobby that cannot
transmit the host's rules is pointless.

**Tech Stack:** TypeScript, Vitest, React 19, Express 5, `ws` 8, MessagePack 3.

## Global Constraints

- Node 24.
- Highest active packet ID is `GAME_UPDATE = 20`. Append from 21. Never
  renumber an active ID.
- The connection-assigned client ID is authoritative. Never trust a sender ID
  inside a packet.
- Add or update tests before changing runtime behavior.
- Guests must be able to host and join. No auth gate on the lobby.
- Default config must keep reproducing today's game.
- Verify: `npm test` + `npm run build` in `server/`; `npm test`,
  `npm run lint`, `npm run build` in `web/`.

## Packet IDs

| ID | Name | Direction | Payload |
| --- | --- | --- | --- |
| 21 | `LOBBY_CREATE` | client to server | `config`, `isPrivate` |
| 22 | `LOBBY_CREATED` | server to client | `{ code, config, isPrivate }` |
| 23 | `LOBBY_LIST` | server to client | `[{ code, hostName, config }]` |
| 24 | `LOBBY_JOIN` | client to server | `code` |
| 25 | `LOBBY_CANCEL` | client to server | none |
| 26 | `LOBBY_SUBSCRIBE` | client to server | `subscribed` |
| 27 | `LOBBY_ERROR` | server to client | `reason` |

`LOBBY_ERROR` reasons: `not-found`, `already-hosting`, `already-in-match`,
`own-game`.

## Notes discovered while reading the code

- The authoritative `place` command validates `locationId` as a non-negative
  safe integer with no upper bound, so 5x5 works online with no protocol
  change. The `> 8` caps in `assertBoardIndex` apply only to the dead legacy
  `GAME_MOVE` / `GAME_MOVES` / `IMMUNE_UPDATE` packets.
- `OnlineAdminSettings` currently admin-gates the rules panel. That gate stays
  for Quick Match, where rules would be imposed on a stranger, but the Create
  Game screen gets an ungated panel: a host owns the rules of their own game.
- Quick Match resolves conflicting proposals as "first queuer wins". A private
  game has exactly one proposer, so that ambiguity disappears.

---

## Task 1: Server carries GameConfig

**Files:** `server/src/matchRules.ts`, `server/src/protocol.ts`,
`server/src/matchCoordinator.ts`, plus their tests.

- [ ] Re-export `clampGameConfig`, `decodeGameConfig`, `DEFAULT_GAME_CONFIG`,
      and `type GameConfig` from `matchRules.ts`.
- [ ] `protocol.ts`: rename the `MATCHMAKING_REQUEST` field `proposedRules` to
      `proposedConfig`, typed `GameConfig`, decoded with `decodeGameConfig`.
- [ ] `matchCoordinator.ts`: replace `MatchRules` with `GameConfig` on
      `MatchRoom`, `RoomFactoryInput`, `QuickMatchEntry`, and the
      `enqueueQuickMatch` / `createRoom` parameters. Rename `.rules` to
      `.config`. Replace `freezeRules` with `freezeConfig`.
- [ ] `GameStartDescriptor` carries `engine: EngineRef` and `config: GameConfig`
      instead of `mode` and `rules`.
- [ ] Build the spec from the room config and read `turnSeconds` from it.
- [ ] Update tests: `proposedRules` becomes `proposedConfig`; assert on
      `expect.objectContaining` so added fields do not break equality.
- [ ] Add a test that a proposed `boardSize: 5` reaches the start descriptor.

## Task 2: Web consumes the server config

**Files:** `web/src/game/protocol.ts`, `web/src/game/onlineMatch.ts`,
`web/src/App.tsx`, plus tests.

- [ ] `protocol.ts`: the game-start descriptor validates `engine` against
      `ENGINE_ID` / `ENGINE_REVISION` and decodes `config` via
      `clampGameConfig`, replacing the `mode` check.
- [ ] `createOnlineMatchConfig` takes a `GameConfig` and spreads it, dropping
      the default-fill shim added during parameterization.
- [ ] `App.tsx` sends the whole `config` on the matchmaking request.
- [ ] `MatchRulesSummary` shows board size and power-up state.

## Task 3: Pending-game registry in the coordinator

**Files:** `server/src/matchCoordinator.ts`, `server/src/matchCoordinator.test.ts`.

- [ ] Add `pendingGames: Map<string, PendingGame>` and
      `pendingCodeByConnectionId: Map<number, string>`, where `PendingGame` is
      `{ code, host: QuickMatchParticipant, config, isPrivate, createdAt }`.
- [ ] `createPendingGame(participant, config, isPrivate)` generates a
      collision-free code from an unambiguous alphabet (no `0`/`O`, `1`/`I`)
      via an injected `createJoinCode` dependency so tests can be deterministic.
      Rejects if the connection already hosts or is already in a room.
- [ ] `listPublicGames()` returns non-private entries as
      `{ code, hostName, config }`.
- [ ] `joinPendingGame(code, participant)` removes the entry and returns
      `createRoom([host, joiner], config)`, or an error reason.
- [ ] `cancelPendingGame(connectionId)`.
- [ ] `abandon()` and disconnect cleanup must also drop a hosted pending game.
- [ ] Tests for: create, list omits private, join by code, join a listed game,
      cancel, host disconnect clears the entry, joining your own game fails,
      joining a missing code fails, hosting twice fails.

## Task 4: Wire the lobby packets in the app

**Files:** `server/src/protocol.ts`, `server/src/app.ts`, `server/src/app.test.ts`.

- [ ] Add the seven packet types and their decoders.
- [ ] Handle `LOBBY_CREATE`, `LOBBY_JOIN`, `LOBBY_CANCEL`, `LOBBY_SUBSCRIBE`.
- [ ] Track lobby subscribers; push `LOBBY_LIST` on subscribe and on every
      change (create, join, cancel, host disconnect).
- [ ] On a successful join, emit `MATCH_FOUND` to both participants exactly as
      Quick Match does, so the existing ready/start flow is reused unchanged.
- [ ] Tests: two connections, one creates, the other sees it listed, joins, and
      both receive `MATCH_FOUND` with the host's config.

## Task 5: Lobby UI

**Files:** `web/src/App.tsx`, `web/src/components/PregameUi.tsx`,
`web/src/game/networkClient.ts`, `web/src/index.css`.

- [ ] `networkClient`: `createGame(config, isPrivate)`, `joinGame(code)`,
      `cancelGame()`, `subscribeLobby(bool)`, and events for
      `lobby-created`, `lobby-list`, `lobby-error`.
- [ ] Enable the two `Coming soon` buttons.
- [ ] Create screen: ungated `AdvancedSettings`, a `Private (join code only)`
      toggle, then a waiting panel showing the code and a cancel button.
- [ ] Find screen: the public list with each entry's config summary and a join
      button, plus a code entry field.
- [ ] Tests for the list rendering and the config summary.

## Task 6: Delete the mode registry and MatchRules

**Files:** `packages/game-core/src/index.ts`, `server/src/matchRules.ts`, tests.

- [ ] Remove `ModeRef`, `ModeRegistry`, `MODE_REGISTRY`, `CLASSIC_V1`,
      `MatchRules`, `DEFAULT_MATCH_RULES`, `decodeMatchRules`,
      `clampMatchRules`, and the `resolveSpec` compatibility shim.
- [ ] `GameSpec` becomes non-optional `{ engine, config, seed, firstSeat }`.
- [ ] Keep the generated-topology test: it uses a literal, not `CLASSIC_V1`.

## Out of scope

Replay (Phase 3) and simultaneous conflict resolution stay deferred.
