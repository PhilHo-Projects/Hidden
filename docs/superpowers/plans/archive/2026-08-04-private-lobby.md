# Hosted lobby outcome

Status: shipped.

## Problem

Players could only use Quick Match and could not host a chosen configuration or
share a private code.

## Shipped solution

- Added one pending-game registry keyed by unambiguous five-character codes.
- Public listing and private code joins read the same registry and converge on
  the existing authoritative room factory.
- Carried the host's complete `GameConfig` into the room and client presentation.
- Appended lobby packet IDs 21-27 and verified public 5x5 and private 4x4 games
  with two real browser tabs.

## Lasting constraints

- Guests may host and join.
- Private games never appear in the public list.
- Host disconnect removes the pending entry.
- Packet IDs and connection-owned identity remain authoritative.
