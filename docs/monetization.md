# Day-zero monetization brief

## Required derived-game outcome

Every ship-track game derived from this template must implement both:

1. at least one genuine, player-facing purchase product; and
2. at least one genuine, player-facing ad placement.

The implementing AI chooses the products, value, price hypothesis, ad formats,
placements, timing, caps, eligibility, and presentation that best fit the
game's audience, core loop, economy, progression, session shape, and natural
breaks. Rewarded ads, interstitials, or both are valid; do not force every
format into every game. Do not copy Pixel Foundry's examples and do not treat
SDK seams, placeholder IDs, disabled cards, hidden diagnostics, or a list of
recommendations as implementation.

This open-source template itself remains fail-closed because it has no derived
game, live catalog, or production IDs. A prototype may defer both channels
until ship-track promotion, and an explicit owner instruction may narrow or
override the model.

- Model: hybrid-capable foundation, disabled by default.
- Non-payer promise: the complete core loop, progression, daily rewards, and quests remain playable without ads or purchases.
- Value moment: the Feature Lab is a developer-facing reference surface and
  keeps both ad actions locked until one demo run has started. A derived
  player-facing game must define and instrument its own value moment before
  enabling either placement.
- Purchase architecture: RUN Shop plus authoritative Entitlements. Do not substitute client-owned grants or low-level RB deduction without a recorded architecture exception.
- Rewarded placement: `template_results_bonus_rewarded`, opt-in and visible in
  the Feature Lab. It grants 100 demo coins exactly once per SDK-confirmed
  completion. LiveOps defaults off, and unavailable/cancelled/error grants
  nothing. Rename the self-authored placement ID in every derived game.
- Product: `starter_bundle`, placeholder Shop item and entitlement IDs. Price must come from the live catalog.
- Interstitial placement: `template_feature_lab_interstitial`, available only
  from an explicit Feature Lab natural-break test. LiveOps defaults off; there
  is no automatic or first-session interstitial. Remove the lab action or adopt
  real spacing/session caps before shipping a derived game.
- Non-authoritative sources: analytics, local storage, client LiveOps, and SDK timeouts never prove ownership or completed value exchange.

## Kill switches and gates

Both `runtime.monetization.adsEnabled` and `runtime.monetization.shopEnabled`
default false. Ad activation also requires platform capability and direct
player interaction. Shop activation additionally requires real catalog and
entitlement IDs. Rewarded completion must be exactly confirmed by the SDK.
Purchases need stable idempotency and authoritative entitlement reconciliation
before any durable grant.

## Measurement

Initial funnel events should cover eligible view, explicit click, SDK open, verified completion/order, reconciliation, grant, cancellation, unavailable, and failure. Primary hypotheses are payer conversion and rewarded completion; guardrails are retention, post-exposure abandonment, economy source share, and non-cancellation error rate. Event delivery never changes player state.

## Required host QA

Exercise unavailable ads, cancellation, SDK false completion, timeout, duplicate taps, backgrounding, purchase cancellation, ambiguous purchase recovery, order history reconciliation, missing entitlement, refund, catalog mismatch, LiveOps kill switch, and offline resume in RUN Playground. Purchases can be real and persistent; use only an approved identity and explicit budget.
