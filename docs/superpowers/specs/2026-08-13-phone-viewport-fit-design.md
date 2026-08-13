# Phone viewport fit for the match screen

Date: 2026-08-13.

## Purpose

On an iPhone 16 in Safari the match screen overflows the visible viewport. The
power-up dock sits at the fold and the rock/paper/scissors dock is clipped
entirely by the browser's bottom toolbar. Both are required controls, so the
screen is not merely ugly on a phone — it is unplayable.

The match screen becomes a box that cannot overflow. Every other screen keeps
its current scrolling behaviour.

## Why the current layout fails

The repository already contains substantial responsive work: `dvh` fallbacks,
`clamp()` type scales, safe-area padding, and breakpoints at 900, 760, 720, 680,
480, and 440 pixels. The failure is not missing effort. It is that the layout
measures a viewport it is not displayed in.

Three defects compound.

`index.html` declares `width=device-width, initial-scale=1.0` without
`viewport-fit=cover`. iOS resolves every `env(safe-area-inset-*)` to zero unless
that keyword is present, so roughly fifteen safe-area rules across `index.css`
are inert on the device they were written for.

`.battle-screen` sets `min-height`, which is a floor rather than a ceiling.
Content taller than the viewport grows past it and `.hidden-shell` scrolls,
which is precisely the observed clipping.

`.battle-arena` is `width: min(43vh, 29rem, 86vw)`. The intent was
height-awareness, but at 393×852 the `86vw` term is 338 pixels and the `43vh`
term is 366, so width wins and the board has no knowledge of remaining vertical
space. The `43vh` term would not have helped regardless: `vh` resolves against
the large viewport, which assumes retracted toolbars.

The same assumption disables the compact rules. `@media (max-width: 680px) and
(max-height: 640px)` was written to shrink the battle header and arena on short
phones, but media-query height tracks the large viewport on iOS Safari, which
reports about 852 on an iPhone 16. The query never matches on the hardware it
targets.

## Budget

On a 393×852 phone with toolbars visible, roughly 660 pixels are usable. After
the fixed navigation bar and shell padding, `.battle-screen` receives about 597.
Current content requires about 645: header 28, turn line 22, announcement 15,
board label 34, gaps and padding 36, power-up dock 76, rock/paper/scissors dock
84, and the board 338.

The overflow is therefore about 50 pixels, and the board alone consumes 57
percent of the budget while being sized by width. This is an allocation problem,
not a density problem. No element needs to be removed, redesigned, or moved
behind a modal.

## Approach

Sizes are never enumerated per device. A device has no single height: toolbars
retract on scroll, in-app browsers differ from Safari, and an installed web app
has no browser chrome at all. The layout instead asks the browser for the height
it currently has and fits itself into that.

`svh` is the unit for the fitting container. It resolves to the smallest
viewport — toolbars visible — which is the only height guaranteed to be on
screen. `dvh` is deliberately rejected here: it tracks the toolbar animation, so
a `dvh`-sized board would resize under the player's finger mid-match.

This also settles browser coverage without per-browser code. Every iOS browser
is required to use WebKit, so Chrome on iPhone reports its own chrome geometry
through the same units, and Android Chrome supports them natively.

## The match screen box

`index.html` gains `viewport-fit=cover`, activating the existing safe-area rules.

`.battle-screen` takes a definite `height` derived from `100svh` less the
navigation chrome and shell padding, plus `overflow: hidden`. It becomes
physically incapable of overflowing.

Its grid rows become header, board label, arena, power-up dock, and
rock/paper/scissors dock, where every row is intrinsically sized except the
arena, which is `minmax(0, 1fr)`.

`.battle-arena` and `.battle-controls` stop being width-driven. The arena takes
`height: 100%` with `aspect-ratio: 1` and `width: auto`, retaining a viewport
width cap so it cannot exceed the screen on a wide short window. The board is
consequently sized by leftover height and can never claim more.

The board is the only elastic element. Header, docks, and labels keep their
current sizes and give up nothing.

The board grid keeps a `max-height` of `29rem`, carried over from the `29rem`
term of the width formula it replaces. An elastic row without a ceiling hands the
board every spare pixel, which on a 1080p window produced a 530-pixel board with
172-pixel cells — larger than the design has ever called for.

The board header is given `width: 0` with `min-width: 100%`. Its caption text is
otherwise the widest thing in the arena, so it, rather than the board, decided
how wide the arena was and the label sat proud of the board's edges. Long names
ellipsize instead.

Two breakpoints restated the arena width as a viewport fraction —
`min(43vh, 24rem, 86vw)` under `max-width: 680px` and `min(38vh, 78vw)` under
`max-width: 680px and max-height: 640px`. Both name `.battle-arena` and both are
dropped from that selector, because either one puts the board back under width
control. Their remaining declarations are kept: the typography and gap
reductions are useful wherever the query does fire honestly, which is Android
Chrome and short desktop windows, and they now compound with the elastic row
rather than fighting it.

## What is not changed

The welcome, setup, results, and menu screens keep `min-height` and continue to
scroll. Scrolling is acceptable and often correct there; the no-overflow
guarantee is specific to the screen holding live controls.

Gameplay, packet handling, and every server contract are untouched. This change
is confined to the client stylesheet and the viewport declaration.

## Verification

Layout cannot be asserted in the existing jsdom test environment, which does not
lay out or resolve viewport units. Verification is visual, against Chrome
DevTools custom devices that subtract browser chrome from the device height,
because stock DevTools presets simulate the full logical screen and therefore
cannot reproduce the bug.

The targets are 393×660 for an iPhone 16 in Safari, 375×553 for an iPhone SE,
440×764 for an iPhone 16 Pro Max, and 393×852 for the chrome-free installed
case. A build that fits the first two fits everything between them.

Measured after the change, with every cell, power-up button and move tile
confirmed inside the viewport and the document not overflowing:

| Viewport | Board | Cell |
| --- | --- | --- |
| 393×660 (iPhone 16, Safari) | 237 | 75.5 |
| 375×553 (iPhone SE) | 217 | 69.0 |
| 1280×800 | 280 | 88.6 |
| 1920×1080 | 464 | 149.9 |

The 1920×1080 board is 464 pixels, identical to what the old `29rem` cap
produced, so the common desktop case is unchanged. Shorter desktop windows lose
size — 280 rather than 344 at 1280×800 — which is the cost of guaranteeing the
fit that the old rule did not provide at that height.

Confirmation on real hardware runs through `npm run dev -- --host` over the local
network. The WhatsApp in-app browser is tested explicitly, since links are shared
through it and its chrome geometry differs from Safari's. Should it misreport
`svh`, the hard height and `overflow: hidden` degrade the board to slightly small
rather than clipping controls off screen.

## Deferred

The reveal popup consumes too much of a phone screen and is a separate pass.

The iPhone SE is not optimised beyond degrading gracefully. If its board proves
too small, a `min-height` floor on the arena, letting the header and
announcement yield first, is a one-property upgrade from this design.

Landscape orientation, installed-web-app display modes, and tablet-specific
layout are out of scope.
