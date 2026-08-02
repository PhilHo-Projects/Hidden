# Server-Authoritative Match Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Share exact classic gameplay between browser and server, then make
Quick Match commands, deadlines, state, scoring, and completion server-owned.

**Architecture:** A root npm workspace contains a dependency-free CommonJS
`@hidden/game-core`. Quick Match creates a trusted in-memory room/run managed by
a coordinator; clients submit revisioned commands and apply only accepted
server updates through the same deterministic core.

**Tech Stack:** Node 24, TypeScript 5.9, React 19, Vite 8, Express 5, `ws` 8,
MessagePack 3, Vitest 4, Docker

## Global constraints

- Never change an active numeric packet ID; append IDs 19 and 20 only.
- Never trust packet sender identity; connection-assigned identity owns the seat.
- Add or update tests before changing runtime behavior.
- Preserve the 16 KiB ceiling, rate limits, heartbeat, structured logging,
  graceful shutdown, guest play, offline play, and one-replica deployment.
- Do not log raw packet bodies at `info`.
- Do not add persistence, private-game UI, alternate boards, replay, or reconnect.

---

### Task 1: Land rules authority and preserve the design

- [x] Re-run web tests, lint, and build on PR #2.
- [x] Re-run server tests and build.
- [x] Build the production image using healthy Hetzner Docker as the approved
  fallback for the unresponsive local Docker Desktop engine.
- [x] Mark PR #2 ready, merge it, and observe the production deployment.
- [x] Verify `/healthz`, conflicting persisted settings, a complete online
  match, and the `AGAIN?` ready handshake using two production browser sessions.
- [x] Create `codex/shared-game-core` from merged `main`.
- [x] Write and commit the approved design and implementation plan.

### Task 2: Establish workspace and characterization baseline

- [x] Add failing characterization tests for current conflicts, immunity,
  power-ups, extra turns, reveal reset, timeouts, turns, scoring, and ties.
- [x] Add the private root workspace for `web`, `server`, and
  `packages/game-core`, with one root lockfile and coordinated scripts.
- [x] Configure the core to emit CommonJS JavaScript and declarations.
- [x] Update the Docker build/runtime stages for workspace dependencies and
  verify existing web/server behavior before moving gameplay.

### Task 3: Extract `classic-v1` and migrate offline play

- [x] Write failing core tests for determinism, immutability, seat symmetry,
  invalid commands, passing, and topology-driven construction.
- [x] Implement seat-neutral classic boards, conflicts, power-ups, extra
  placements, seeded timeouts, passing, scoring, and results.
- [x] Move `MatchRules` into the core and remove mirrored definitions.
- [x] Add the web presentation adapter and migrate offline/bot play while
  keeping online relay behavior unchanged.
- [x] Verify all packages and Docker, review, push, merge, deploy, and smoke the
  shared-core PR; then branch `codex/server-authoritative-match-cycle`.

### Task 4: Implement lifecycle stages 1-3

- [x] Write failing coordinator tests for discovery, immutable run specs,
  trusted seats, readiness, UUIDs, injected seed/clock/timers, and cleanup.
- [x] Split socket transport from `MatchCoordinator` gameplay ownership.
- [x] Create stable rooms and fresh UUID runs with immutable `classic@1`, rules,
  participants, seed, first seat, revision, and deadline.
- [x] Append the keyed start descriptor to packet 15.

### Task 5: Implement lifecycle stages 4-6

- [x] Write failing protocol and behavior tests for packet IDs 19/20, spoofing,
  revisions, deduplication, illegal actions, power-ups, deadlines, legacy
  packets, finish locking, disconnect, and rematch.
- [x] Decode keyed commands defensively and derive actors from sessions.
- [x] Resolve accepted commands in the canonical core and broadcast revisioned
  command/effect batches, including extra-turn buffering.
- [x] Own placement-window deadlines, late-command ordering, seeded timeouts,
  automatic passing, finish locking, and fresh transient rematch runs.

### Task 6: Integrate the authoritative client and open the final draft PR

- [x] Write failing client tests for server-confirmed state, rejection, accepted
  batches, display-only online timers, and fail-closed revision gaps.
- [x] Replace legacy online gameplay sends with revisioned commands and apply
  accepted updates through the shared core.
- [x] Add two-WebSocket full-match coverage and two-browser online/offline smoke.
- [x] Run core tests/build, web tests/lint/build, server tests/build,
  `git diff --check`, and the root Docker build.
- [x] Complete independent review and resolve all Critical/Important findings.
- [x] Push `codex/server-authoritative-match-cycle` and open a draft PR; do not
  merge or deploy it.
