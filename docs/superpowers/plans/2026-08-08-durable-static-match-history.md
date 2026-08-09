# Durable Static Match History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist mechanics-independent final online-match snapshots and let each authenticated participant browse, inspect, and bookmark their own history.

**Architecture:** `MatchCoordinator` emits one immutable completion DTO into a bounded asynchronous PostgreSQL recorder. Cookie-authenticated HTTP endpoints project stored records into the requesting player's perspective; a dedicated web client and history component render summaries and static boards without importing live engine state.

**Tech Stack:** Node 24, TypeScript, PostgreSQL 16/`pg`, Express 5, React 19, Vitest, Node test runner, Docker.

## Global Constraints

- Preserve all live packet numbers and WebSocket behaviour; history adds no packet.
- Never execute historical records through `game-core`.
- Record completed server-authoritative online matches only.
- A history write failure must not prevent either player receiving game over.
- Fixed page size is 20 and is not a retention cap.
- No R2, admin console, public sharing, replay timeline, cleanup, or deployment.
- Follow TDD and keep each task independently green.

---

### Task 1: Completion snapshot

**Files:** `server/src/matchHistory/types.ts`, `server/src/matchCoordinator.ts`, coordinator tests.

- [ ] Write failing tests proving a completed run emits exactly one version-1
  snapshot with participants, scores, opaque context, and symbol-only boards.
- [ ] Prove abandoned and replaced runs do not emit completion records.
- [ ] Add the immutable DTO builder and optional completion sink.
- [ ] Run server coordinator tests and commit the green task.

### Task 2: PostgreSQL repository and recorder

**Files:** `server/migrations/002_match_history.sql`, `server/src/matchHistory/repository.ts`, `server/src/matchHistory/recorder.ts`, tests.

- [ ] Write failing repository/recorder tests for idempotent insertion, participant
  history, perspective stats, keyset pagination, bookmark isolation, account
  deletion, three total write attempts, safe logging, and flush.
- [ ] Add normalized record, participant, and bookmark tables plus indexes.
- [ ] Implement repository queries and the bounded asynchronous recorder.
- [ ] Run unit tests and PostgreSQL 16 integration tests; commit the green task.

### Task 3: Authenticated history API

**Files:** `server/src/matchHistory/http.ts`, `server/src/app.ts`, `server/src/server.ts`, app tests.

- [ ] Write failing HTTP tests for authentication, perspective projection,
  cursor/filter handling, participant-only detail, bookmark origin checks,
  no-store responses, and error mapping.
- [ ] Add `GET /api/history`, `GET /api/history/:matchId`, and
  `PUT /api/history/:matchId/bookmark`.
- [ ] Wire the repository and recorder through startup and graceful shutdown.
- [ ] Run the server suite and commit the green task.

### Task 4: Web data boundary

**Files:** `web/src/history/historyClient.ts`, `web/src/history/types.ts`, tests.

- [ ] Write failing tests for list/detail decoding, bookmark requests, unknown
  symbols, 401 session expiry, and retryable failures.
- [ ] Implement the dedicated client and mechanics-independent DTOs.
- [ ] Run focused web tests and commit the green task.

### Task 5: Personal history interface

**Files:** `web/src/components/MatchHistory.tsx`, `web/src/components/ProfileMenu.tsx`, shell/view-model integration, component CSS/tests.

- [ ] Write failing component and view-model tests for profile navigation, return
  navigation, stats, filters, rows, pagination, details, static boards, bookmark
  rollback, loading, empty, error, and session-expired states.
- [ ] Implement the full history screen using the existing brush/block visual
  system, ≥48 px controls, semantic focus states, and responsive paired boards.
- [ ] Verify unknown symbol fallback and reduced-motion behaviour.
- [ ] Run web tests, lint, and build; commit the green task.

### Task 6: Documentation and complete verification

**Files:** `docs/ROADMAP.md`, `DESIGN.md`.

- [ ] Record durable static history separately from deferred chess-style replay
  and the future admin research/cleanup console.
- [ ] Run `npm test`, `npm run lint`, `npm run build`, PostgreSQL integration
  tests, and `docker build` from the repository root.
- [ ] Drive a real two-account match plus a third-account denial in the browser;
  verify perspective, boards, totals, pagination, and independent bookmarks.
- [ ] Review the final diff for secrets, raw history logging, unrelated UI edits,
  and protocol-number changes; commit documentation only after evidence is fresh.
