# Project continuity documentation decision

Status: shipped; current document roles supersede the original timeline format.

## Problem

New collaborators had to reconstruct deployment history and product direction
from chat transcripts and Git history. That consumed context and mixed current
instructions with obsolete migration detail.

## Decision

- The root `README.md` owns setup, operation, verification, and production
  configuration.
- `docs/ROADMAP.md` owns current direction and future work.
- `docs/JOURNAL.md` owns concise completed milestones, newest first.
- `DESIGN.md` owns current product and UX behavior.
- `docs/README.md` is the minimal navigation index.
- `AGENTS.md` and `CLAUDE.md` remain identical and hold source boundaries,
  runtime invariants, and change discipline.

## Lasting constraints

- Distinguish shipped, current, and proposed work.
- Record decisions and verification outcomes, not command transcripts.
- Keep credentials, tokens, machine paths, and deployment secrets out of the
  repository.
- Historical implementation detail belongs in Git; archived documents should
  not be required to start current work.
