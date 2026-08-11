# Split the App shell — Implementation Plan

**Status:** complete as of 2026-08-11.

**Goal:** Make `web/src/App.tsx` something you can change one part of without
reading all of it, and without loading 1,550 lines into context to find where a
bug lives.

## Completion summary

The extraction was completed in the planned risk order, one hook per commit:

| Hook | Responsibility |
| --- | --- |
| `useDestructionEffects` | Local-board destruction animation state and timeout cleanup |
| `useLobbyBrowser` | Hosted-lobby creation, discovery, joining, and lobby errors |
| `useAccountSession` | Session hydration, guest identity, login/register, and logout |
| `useMatchSession` | Offline and online match lifecycle, network events, countdowns, moves, and disconnects |

`App.tsx` moved from 1,641 lines to 870 lines. The screen render tree remains in
`App.tsx`, while the extracted stateful subsystems live under `web/src/hooks/`.
No CSS, gameplay rules, packet IDs, wire shapes, or server runtime files changed.

## Read this first: the obvious plan is the wrong one

"Split `App.tsx` into per-screen components" is the intuitive answer and it is
wrong. Measured on 2026-08-06:

| Half | Lines | State |
| --- | --- | --- |
| Hook body (state, effects, callbacks) | ~920 | The problem |
| Render tree | ~500 | Already fine |

The render tree is fourteen `{screen === 'x' ? (…) : null}` blocks, and the
biggest is 82 lines:

```
intro 57   account 12   mode-select 33   online-menu 36   lobby-create 45
lobby-find 64   offline-setup 20   matchmaking 11   ready 16   countdown 5
battle 82   results 34   disconnected 11   sync-lost 22
```

Those blocks read fine where they are. Extracting them means threading roughly
forty props each through a new boundary, which trades a long file for a wide
one and makes the coupling harder to see, not easier. **Do not start here.**

The 920-line hook body is the real target: 29 `useState`, 9 `useRef`,
13 `useCallback`, 9 `useEffect`, all in one function body.

## The actual difficulty

`onClientEvent` (App.tsx:339, **177 lines**) is the hub. One switch over every
server event, and its branches touch nearly every state cluster below. Any split
has to decide what happens to it first. Everything else is downstream of that
decision.

## State clusters

Grouped by what actually belongs together, with the coupling that makes each one
hard. Ordered by ascending risk — do them in this order.

### 1. `useDestructionEffects` — low risk, completed

- State: `playerDestructionEffects`
- Refs: `destructionSequenceRef`, `destructionTimeoutsRef`
- Callback: `queueDestructionEffect`
- Effect: the unmount timeout cleanup

Only consumer is `applyEngineResult`, which calls `queueDestructionEffect` on a
`cell-destroyed` event. Self-contained, no coupling outward. Opponent-board
destruction remains deliberately unexposed because it would leak placement
information.

### 2. `useLobbyBrowser` — low risk, completed

- State: `lobbyGames`, `hostedCode`, `hostingStarted`, `isPrivateGame`,
  `joinCodeInput`, `lobbyError`

Coupled outward only through `clientRef` calls and `setScreen`. Pass the client
in. The `lobby-created`, `lobby-list`, and `lobby-error` branches of
`onClientEvent` become one handler this hook exposes.

### 3. `useAccountSession` — medium risk, completed

- State: `authUser`, `authHydrated`, `authMode`, `authBusy`, `authError`,
  `guestUsername`
- Callbacks: `openAccount`, `submitAccount`, `logout`
- Effect: the session hydration on mount

Coupled to `setStatus`, `setScreen`, and `closeClient`. `logout` closes the
socket, so the hook needs that passed in rather than owning it. Careful: account
availability must never block guest or offline play — the existing `.catch()`
that swallows a failed session lookup is load-bearing.

### 4. `useMatchSession` — high risk, completed last

- State: `match`, `onlineRules`, `announcement`, `turnTimeLeft`, `countdown`,
  `users`, `readyLocked`, `clientId`, `onlineInputPending`
- Refs: `clientRef`, `matchRef`, `screenRef`, `manualCloseRef`,
  `onlineAuthorityRef`, `countdownRunRef`
- Callbacks: `applyEngineResult`, `beginCountdown`, `enterSyncLost`,
  `onClientEvent`, `onTimeout`, `onAiTurn`, `closeClient`

This is most of the file and all of the risk. The `matchRef` / `screenRef`
mirrors of `match` / `screen` exist because `onClientEvent` is a stable callback
that must read current values — that pattern must survive the move or the
online flow breaks in ways tests may not catch.

## Constraints

- **Behaviour must not change.** This is a restructure, not a redesign.
- `ENGINE_REVISION` is untouched. No packet, no wire shape, no protocol file.
- Preserve online matchmaking, lobby, ready/start, moves, power-ups, disconnect
  handling, and offline bot play.
- The terminal-screen guards (`tryMarkOnlineTerminalScreen`) exist so a
  disconnect and a sync-lost cannot both fire. Do not lose that ordering.
- Verify with `npm test`, `npm run lint`, and `npm run build` from the root
  after **each** extraction, not once at the end.

## Sequencing

One hook per commit, in the order above, each independently revertible. Stop
after any step: a file with two hooks extracted and four clusters inline is a
coherent state, not a half-finished one.

## Verification beyond tests

The final verification covered the complete root test suite, lint, build, and a
real-browser offline flow through guest entry, navigation, countdown, a live
move/round transition, return flow, and account navigation. Direct WebSocket
handshakes succeeded against both the Node service and Vite proxy. The in-app
browser harness could not establish its own WebSocket connection, so hosted
match start, intentional close, unexpected disconnect, and pre-ID start ordering
are also guarded by focused `useMatchSession` tests. A full two-browser
power-up match remains a useful manual smoke test when running outside that
harness.
