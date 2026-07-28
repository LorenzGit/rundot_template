# The host reality gap

A class of defect that is invisible in `npm run dev`, in headless Chrome, and in
ViewDeck, and appears only once the game is embedded in the RUN host on a real
handset. Each item below shipped to a device before being caught, in a project
whose gate already ran invariants, a headless simulation, and a screenshot pass.

What they share: **the local environment supplies a benign default where the
host supplies something hostile or absent.** Testing against the benign default
proves nothing, and worse, reports success.

## 1. Safe-area insets are untrusted input

`RundotGameAPI.system.getSafeArea()` is the single most dangerous number the host
hands you, because HUD and modal layout anchors to it.

**With no host it is zero on every edge.** Every local test therefore runs a
layout that has never seen an inset. The first time real values arrive is on a
player's phone.

Failure signature, all from one cause:

- Bottom-anchored HUD flies off the *top* of the screen (a movement stick at
  `y: -65`, a label at `bottom: -6`).
- A bottom-anchored bar renders *above* a top-anchored one — the HUD inverts.
- Menus clip from the top and modals squash, because screens pad from the same
  insets.

Clamp before use, in both directions and on two levels:

```ts
// No real inset eats this much of an axis; a larger reading is a bad one —
// device pixels against a CSS-pixel frame, or a measurement taken pre-layout.
const MAX_EDGE = 0.3;   // per edge
const MAX_AXIS = 0.4;   // both edges of an axis together
```

Per-edge clamping alone is not enough: two edges at 30% still remove 60% of an
axis, which squeezes a sheet until its button rail is taller than its content.
Clamp the magnitude, not the sign — a letterboxed frame legitimately receives
*negative* offsets so the HUD can reach back out toward the host boundary.

Convert against `window.visualViewport`, not `innerWidth/innerHeight`. Inside a
webview the layout box is larger than the visible box, and measuring the frame
against the wrong one turns a small real inset into a screen-eating one.
Recompute on `resize`, `orientationchange`, and `visualViewport`
resize/scroll — a host toolbar sliding away changes the visible box without
firing a window resize.

## 2. An ad takes keyboard focus and does not give it back

The host presents ads over or beside the document. When one closes, focus can
stay with the overlay, so `keydown` never reaches your window listeners. Pointer
input still lands on the canvas, so **the game looks alive while the keyboard is
dead** — which reads to a player as "WASD stopped working after an ad".

Route every ad through one handler that, on dismissal, calls `window.focus()`
and focuses a `tabindex="-1"` app frame. On presentation *start*, clear any keys
you believe are held: a key released during the ad never sent you a `keyup`, and
two opposite keys stuck at once cancel out and look identical to dead input.

This is untestable headlessly — synthetic `KeyboardEvent`s dispatched on
`window` reach listeners regardless of focus. Assert the wiring instead: every
ad call site must go through the shared handler, and fail the build if any ad
ducks audio without also restoring input.

## 3. Host-gated UI hides itself locally, so QA measures a hole

Offers, rewarded prompts, and entitlement-gated surfaces hide when there is no
host. Screenshot and layout tests then measure a results screen with a `0px` gap
exactly where the broken element sits on a device.

In this project the clipped element was the rewarded-ad offer — the one thing on
the death screen a player might act on — and three consecutive layout fixes
passed QA while it was visibly sliced in half.

**Force host-gated surfaces visible in layout tests.** Do not wait for a host to
reveal them.

## 4. `[].every()` marks every consumable as owned

A consumable's `expectedEntitlementIds` is empty, and `[].every(...)` is
vacuously `true`. Ownership computed as

```ts
const owned = entitlementsLoaded && definition.expectedEntitlementIds.every(has);
```

flips to `true` for every consumable the moment entitlements load, rendering
`OWNED` and setting `purchasable: false`. **The currency packs become
unbuyable**, silently, only once a host is present.

Require a non-empty entitlement list *and* a non-consumable kind. Ownership is
only meaningful for something you can own once.

## What to add to a browser QA pass

One pass at a phone size with host insets applied catches most of the above:

- Drive the **real** inset conversion with a hostile reading (e.g. host values
  in device pixels against a CSS-pixel frame), not hand-set CSS variables, so
  the clamp is what is under test.
- Assert no HUD element leaves the viewport and that bottom-anchored elements
  stay below top-anchored ones.
- Assert the document cannot scroll.
- Open every modal, force host-gated blocks visible, and assert every action is
  inside its sheet and not collapsed.
- Assert fixed-content modals fit outright rather than hiding content behind a
  sticky rail.

Useful viewport: a landscape handset gives the game a *narrow middle column*
because host chrome occupies both edges. `718x440` CSS is a realistic worst case
and far shorter than the sizes most suites test.
