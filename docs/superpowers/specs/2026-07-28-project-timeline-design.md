# Hidden Project Timeline Design

## Purpose

Give future conversations an accurate, low-maintenance starting point for the
Hidden web project. A new collaborator should be able to understand what is
deployed, how the project works, what constraints are intentional, and what
direction is currently planned without reconstructing the migration history.

## Scope boundary

Only documentation inside the `Hidden` repository is in scope:

- `TIMELINE.md`
- `README.md`
- The repository's `AGENTS.md`
- The repository's `CLAUDE.md`

User-level, machine-wide, and cross-project instruction files must not change.
The project-local `AGENTS.md` and `CLAUDE.md` will remain identical.

## Timeline structure

`TIMELINE.md` will use a hybrid format:

1. **Current snapshot** — live URL, repository, deployed architecture,
   delivery flow, verified resource footprint, and intentional limitations.
2. **Current direction** — the next useful product work, currently UI polish,
   game balance, onboarding, bots, and experimental game modes.
3. **Later possibilities** — backend work that is valuable only when product
   needs justify it, such as authoritative rules, reconnection, persistence,
   accounts, staging, and stronger CI gating.
4. **Dated journal entries, newest first** — one entry per meaningful work
   session or milestone, recording outcomes, decisions, validation, and
   remaining follow-ups.

The initial dated entry will summarize the web extraction, hardening, Coolify
deployment, webhook verification, legacy cutover, and Unity prototype archival
completed on 2026-07-28.

## Maintenance rules

The project-local agent instructions will tell future collaborators to:

- Read `README.md` and `TIMELINE.md` before planning material work.
- Keep the current snapshot aligned with deployed reality.
- Update the current and later direction when priorities change.
- Add a single concise journal entry after a meaningful session, milestone,
  deployment, architectural decision, or plan change.
- Clearly distinguish completed, current, and proposed work.
- Record useful evidence and decisions, not routine command transcripts.
- Never place credentials, tokens, machine-only paths, or raw sensitive output
  in the timeline.

## README integration

`README.md` will gain a short project-continuity section linking to
`TIMELINE.md`. It will continue to be the operational overview, while the
timeline owns evolving status, decisions, and direction.

## Acceptance criteria

- `TIMELINE.md` gives a fresh conversation enough context to start product work.
- The migration is represented as one coherent dated entry.
- The snapshot accurately describes the current live deployment and caveats.
- `AGENTS.md` and `CLAUDE.md` remain byte-for-byte identical.
- No global instruction files change.
- Documentation contains no credentials, machine-specific paths, or obsolete
  deployment references.
- The repository is clean after the documentation commit.
