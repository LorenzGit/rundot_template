# Standard Event Catalog

Event names are not free-form. RUN's creator analytics runs four separate
queries over your events, and three of them filter on a **fixed allow-list of
event names** held server-side in
`venus/server/cloud-run/src/services/creatorAnalytics.service.ts`
(`COMMON_EVENT_GROUPS`). An event whose name is not on that list can only ever
appear in the fourth query, `top_custom_events_30d` — **which returns at most 25
rows per game**.

So a name is not cosmetic. It decides which query your event lands in, and
whether it is visible at all once a game has more than 25 event types.

| Query | Contains | Row cap |
|---|---|---|
| `core_loop_events_30d` | only the core-loop names below | none observed |
| `economy_events_30d` | only the economy names below, **plus a value sum** | none observed |
| `monetization_events_30d` | only the monetization names below, **plus a value sum** | none observed |
| `top_custom_events_30d` | everything else, busiest first | **25** |

**Use the canonical name whenever the beat matches**, even if your game calls it
something else internally. A roguelike's "dungeon run" is a `run_started`; a
match-3's "puzzle" is a `run_started`. Emit your own descriptive event *as well*
if you want it — but the canonical one is what makes the data queryable.

## Core loop — `core_loop_events_30d`

| Event | When | Key payload |
|---|---|---|
| `game_opened` | First playable frame after boot | `first_time_player` |
| `screen_viewed` | Any screen/menu shown | `screen` |
| `ftue_started` | First-time flow begins | — |
| `ftue_completed` | First-time flow finished | `elapsed_sec` |
| `game_mode_start` | A mode/difficulty is chosen | `mode` |
| `run_started` | A run/round/puzzle/match begins | `run_id`, `mode` |
| `run_completed` | That run ends in success | `run_id`, `score`, `time_elapsed_sec` |
| `run_failed` | That run ends in failure | `run_id`, `reason`, `progress_pct` |
| `level_started` | A discrete level begins | `level_id`, `level_number` |
| `level_completed` | That level is cleared | `level_id`, `score`, `time_elapsed_sec` |
| `level_failed` | That level is lost | `level_id`, `reason`, `progress_pct` |
| `player_death` | The avatar dies | `cause` |

The allow-list also carries `class_selected`, `zone_selected`, `floor_reached`
and `mercenary_hired`, which came from an RPG title. Ignore them unless your game
genuinely has those beats — an unused name on the list costs nothing.

## Economy — `economy_events_30d`

This query is empty for a game that emits none of these names, no matter how
much economy the game actually has.

| Event | When | Key payload |
|---|---|---|
| `currency_earned` | Soft/hard currency granted | `amount`, `currency`, `source` |
| `currency_spent` | Currency consumed | `amount`, `currency`, `sink` |
| `reward_claimed` | Any reward taken (daily, quest, chest, ad) | `amount`, `reward_id`, `source` |
| `shop_purchase` | Bought with **in-game** currency | `item_id`, `cost`, `currency` |
| `item_equipped` | Loadout change | `item_id` |
| `item_sold` | Item converted back to currency | `item_id`, `amount` |

**`total_value` on this query sums `amount`, then `cost`, then `gold_gained`,
in that order.** Omit all three and the row still appears with a value of 0.

## Monetization — `monetization_events_30d`

| Event | When | Key payload |
|---|---|---|
| `store_opened` | Shop/IAP surface opened | `placement` |
| `offer_shown` | An offer is displayed | `offer_type`, `placement` |
| `offer_clicked` | Player taps into the offer | `offer_type`, `product_id` |
| `offer_dismissed` | Player declines it | `offer_type`, `reason` |
| `iap_purchase_started` | Checkout begins | `product_id`, `cost` |
| `iap_purchase_complete` | Checkout succeeds | `product_id`, `cost` |
| `iap_purchase_failed` | Checkout fails | `product_id`, `reason` |
| `first_purchase` | The player's first ever purchase | `product_id`, `cost` |
| `premium_purchased` | Subscription / premium tier bought | `tier`, `cost` |
| `rewarded_ad_offered` | Rewarded ad offered to the player | `placement` |
| `rewarded_ad_watched` | SDK confirms completion | `placement`, `reward_id` |
| `rewarded_ad_dismissed` | Player cancels or it fails | `placement`, `reason` |
| `interstitial_shown` | Interstitial displayed | `placement` |

**`total_value` sums `cost`, then `price_runbucks`, then `priceRunbucks`, then
`amount`.** Include one on every purchase event or the value column reads 0.

`monetization_context` is grouped from the first present of `offer_type`,
`placement`, `product_id`, `productId`, `offering_id`, `tier` — always send at
least one, or every row collapses into `unknown`.

Ad *revenue* is not reportable by the game: `RundotGameAPI.ads.showRewardedAdAsync()`
resolves to a boolean, so only RUN knows what an impression earned. Send the
events for funnel visibility, and do not expect `total_value` to reflect ad income.

## Errors, experiments, funnels

These are unaffected by the allow-list.

| Event | When | Key payload |
|---|---|---|
| `error_occurred` | try/catch, `window.error`, `unhandledrejection` | `type`, `message`, `source`, `line` |
| `experiment_exposure` | Immediately after `getExperiment` resolves non-null | `experiment`, `variant`, `group` |

Always fire `error_occurred` for queryable triage **and** `RundotGameAPI.error(...)`
for the mobile support log. `installErrorCapture()` wires the global listeners.

Funnels go through `trackFunnelStep(step, name, funnel, order)`, a separate
pipeline that feeds `funnel_steps_30d`. Funnel **step** names are free-form and
have no allow-list — name them for the beat they represent.

### FTUE funnel (`funnel: 'ftue'`, funnelOrder 1)

The single most important funnel in a new game. Three rules:

1. **As granular as possible.** Every discrete beat of the first session is its
   own step — each tutorial text shown AND dismissed, the first enemy spawning
   AND dying, the first currency earned. Expect 15–40+ steps, not a handful.
2. **Strictly linear.** Fixed order, numbered sequentially, no branches.
3. **Fire once, ever** (`trackFunnelStepOnce`), so replays don't pollute it.

Correctly instrumented, step counts decrease monotonically. A later step with
more hits than an earlier one means the ordering or dedup is wrong.

### Purchase funnel (`funnel: 'purchase'`, funnelOrder 2)

`shop_opened` → `item_selected` → `checkout_started` → `purchase_complete`.
These are funnel *steps*; the queryable events for the same beats are
`store_opened` / `offer_clicked` / `iap_purchase_started` / `iap_purchase_complete`
above. Emit both.

## Payload conventions

- `snake_case` keys, scalar values only (`string | number | boolean | null`).
- IDs over names for joins (`level_id`), human names optional alongside.
- Durations in seconds with a `_sec` suffix; percentages 0–100 with `_pct`.
- Currency amounts as integers with an explicit `currency` field.
- Value fields matter: see the `total_value` notes per query above.

## Adding a game-specific event

Use `snake_case` and the same payload conventions. It will land in
`top_custom_events_30d` and compete for the 25 available rows, so add the
canonical event alongside it rather than instead of it.

New event names must be shared with the RUN Operators team before they appear in
platform dashboards.
