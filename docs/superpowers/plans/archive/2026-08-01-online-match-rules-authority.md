# Online rules authority outcome

Status: shipped.

## Problem

Each online client could start from retained local practice settings, producing
different rules and broken completion/rematch behavior.

## Shipped solution

- The server resolved and clamped one rules value for the room and delivered it
  to both players.
- Authenticated admin role came from `ADMIN_USERNAMES`; packet-supplied role was
  ignored.
- Online rematch returned through the shared ready handshake.
- Client/server tests covered authority, fallback, clamping, role, and rematch.

The original `MatchRules` contract later became full `GameConfig`; the authority
boundary remains.

## Lasting constraints

- Connection identity is authoritative.
- Offline settings never decide online rules.
- Active packet IDs remain fixed and raw packets are not logged at `info`.
