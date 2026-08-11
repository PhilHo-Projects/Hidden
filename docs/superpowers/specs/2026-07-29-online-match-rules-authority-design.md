# Online rules authority decision

Status: shipped; the original `MatchRules` shape later evolved into
`GameConfig`.

## Problem

Online clients started matches from their own retained offline settings. Two
players could therefore use different round counts or blindness and disagree
about whether the match had ended. Online rematch also restarted locally and
could make both clients believe they moved first.

## Decision

- The server resolves one clamped configuration when a room is created and
  sends the same value to both players.
- Online clients never derive canonical rules from local practice settings.
- Rematch reuses the two-player ready handshake and creates a fresh run.
- Administrator role is derived case-insensitively from `ADMIN_USERNAMES` at
  session/request time. Client role is a rendering hint, never authorization.
- Guests and ordinary players cannot grant themselves role or rules authority
  through packets.

## Lasting constraints

- Connection identity and seat are authoritative; sender IDs and roles in
  payloads are not.
- Malformed configuration falls back safely and numeric values are clamped.
- Active packet numbers remain fixed; compatible fields may only be appended.
- Rule rejection does not disconnect a client. Malformed MessagePack retains
  the protocol close policy.
- Offline practice remains locally configurable because there is no second
  client with which to desynchronize.
