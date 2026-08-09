# Hidden documentation index

**Read this first, then stop.** Do not read the whole `docs/` tree — one
archived plan alone is 1,600 lines and reading it will not tell you anything
this index does not.

| If you want | Read | Size |
| --- | --- | --- |
| Current state and what to do next | [ROADMAP.md](ROADMAP.md) | ~265 lines |
| What shipped and when | [JOURNAL.md](JOURNAL.md) | ~155 lines |
| Why the rules engine is shaped this way | [specs/2026-08-03-game-mode-testbed-design.md](superpowers/specs/2026-08-03-game-mode-testbed-design.md) | ~245 lines |
| Why static history is separate from replay | [specs/2026-08-08-durable-static-match-history-design.md](superpowers/specs/2026-08-08-durable-static-match-history-design.md) | ~90 lines |

`ROADMAP.md` alone is enough to pick up work. Everything else is background.

One open plan: [splitting the App shell](superpowers/plans/2026-08-06-split-app-shell.md).
Everything in `superpowers/plans/archive/` is finished.

## Archived

`superpowers/plans/archive/` holds finished plans. They are step-by-step
implementation scripts whose work is already committed and verified. Open one
only if you need to know exactly how a specific past change was sequenced —
never to find out what the project is or what to do next. The git history is
the better record for that.

## Project rules

Contributor rules live in `CLAUDE.md` and `AGENTS.md` at the repository root,
not here. Read those before changing code.
