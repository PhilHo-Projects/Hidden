# Reveal as a timed snapshot

Date: 2026-08-14.

## Purpose

Reveal was meant to be a glance at the opponent's board. It is currently a panel
that opens beside the player's own board and stays open until their next
placement, which is neither a glance nor something a phone has room for: at
phone widths the panel lands on top of the board it is supposed to sit next to.

This changes reveal into what it was designed to be. Activating it shows the
opponent's board for a fixed window, covering the player's own board for the
duration, and then takes it away. What the player carries into their placement
is what they remembered.

## The rule

`revealActive` stops being open-ended. It is raised by `activate-powerup` as
today and lowered by whichever comes first:

- the reveal window expiring, `config.revealSeconds` after activation;
- the player placing, which already clears it;
- the player closing the snapshot early.

`revealSeconds` joins `turnSeconds` in `GameConfig`, defaulting to 1.5. It is a
configured rule rather than a constant so the offline rule controls can tune it
and so tests can drive it to a floor, the way `MIN_TURN_SECONDS` already works.

The turn clock keeps running underneath. Reveal costs the player 1.5 seconds of
their turn, and that price is the point: the information is not free, and having
to place under a shortened clock is what makes the memorised board matter.

## Why the authority owns the timer

`game-core` is a pure state machine with no clock, and the server relays
*commands and events* rather than board snapshots — each client replays them
into its own copy of the core. Two sides running their own 1.5s timers would
lower `revealActive` at slightly different revisions, the copies would disagree,
and the match would drop into sync-lost.

So expiry is delivered the way every other state change is: as a command from
the authority. `game-core` gains

    { readonly type: 'end-reveal' }

which clears `revealActive` for the acting seat and is idempotent — ending a
reveal that is not running is accepted and changes nothing. Idempotence is what
lets the early-close request and the expiry race harmlessly.

The command is additive. Commands are validated by a string `type` switch, so no
numeric packet ID changes and the protocol is not broken.

`MatchCoordinator` arms the window when it accepts a reveal activation, using the
same injected `now()` and timer machinery that already drives turn deadlines, and
submits `end-reveal` for that seat when it fires. Offline play runs the same
sequence from the client-side match session, which is already the authority
there.

## Closing early

The player may dismiss the snapshot before the window ends; the client sends
`end-reveal` when they do. This cannot be abused. The authority's own timer still
fires at `revealSeconds` regardless of what the client sends, so a client can
only ever end its reveal *earlier* than the rule allows, never extend it.

## Presentation

The snapshot is a modal that covers the whole match screen rather than a panel
beside the board. Covering the player's own board is the intended behaviour, not
a side effect: taking it away is what makes the snapshot a snapshot, and it is
what gives the layout somewhere to go on a phone.

The countdown lives on the frame — a ring of bulbs around the border
extinguishing one at a time clockwise, going red and blinking over the last
quarter. There is no progress bar and no number; the frame is the clock. The
treatment is the `marquee` variant from `art/lab/reveal-snapshot/`.

The modal names whose board it is. A snapshot that does not say "opponent" is a
board the player may read as their own, and the whole feature depends on not
confusing the two.

`DESIGN.md` currently requires the opposite — that reveal "must not resize or
replace the player's board". That line is superseded and is rewritten with this
change.

## Not doing

**Pausing the turn clock.** A paused clock is new state both sides have to agree
on, for a rule that reads better unpaused.

**Server-side board redaction.** Blind mode is already a presentation-layer
secret: every client replays the full canonical state and has always held the
opponent's board in memory. A timed reveal neither weakens nor strengthens that.
Making the blind board server-enforced is a real piece of work and an
independent one; it is not smuggled in here.

## Testing

`game-core` covers the new command directly: expiry clears `revealActive`,
`end-reveal` on an inactive reveal is accepted and inert, placing still clears
reveal without waiting for expiry, and a second `end-reveal` is harmless.

`MatchCoordinator` covers that accepting a reveal arms the window, that the
window submits `end-reveal` for the right seat on a driven clock, and that an
early client `end-reveal` does not stop the authority's own timer from being a
no-op when it lands.

The web package covers that the modal renders while reveal is active, that it
identifies the opponent, and that dismissing it sends the command. The marquee
bulbs are asserted through the stylesheet the way the score walk is, since the
count and the extinguish order are the behaviour.
