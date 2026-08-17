# Release and progression dashboard contract

Use this contract when building a game dashboard, analytics collector, or
release report.

## Required evidence

- Store `observed_at`, source/window time, collection time, query name, row
  count, success/error state, and freshness per stage.
- Append observations; do not overwrite the only historical baseline.
- Tag every custom event with `build_version`. Preserve the deployed version
  and release time so rollout can be measured against a pre-release baseline.
- For level/run games, emit stable `level_started`, `level_restarted`,
  `level_completed`, and `level_abandoned` events with numeric `level`, stable
  `level_id`, attempt counts, active duration, and bounded difficulty/mode
  dimensions.

## Honest interpretation

- Treat declared and observed events as different facts. Absence from a top-N
  export is sample-limited, not proof that instrumentation is broken.
- Reject non-monotonic funnels from product conclusions until ordering or
  deduplication is repaired.
- Label all-version aggregates explicitly. Attribute release effects only when
  outcome metrics can be grouped by `build_version` and the new build has an
  adequate sample.
- Show unavailable, stale, empty, and failed sources separately.

## Collector shape

- Interactive refresh: run small catalog/activity/platform/version/retention/
  error queries concurrently and keep cached deep analytics and marketing.
- Scheduled refresh: collect complete funnels, custom events, economy,
  monetization, experiments, campaign data, and local readiness.
- Record latency per query. A slow optional export must not block the game-page
  refresh.

## Platform/reporting gaps to build

1. A dimensional custom-event aggregate that groups approved low-cardinality
   properties such as `build_version`, `level`, `level_id`, `mode`, and
   `difficulty`, including count, players, median, and p95 for numeric fields.
2. First-class deploy annotations and version adoption so release baselines do
   not depend on collector timing.
3. Ingestion health by event and version: accepted, rejected, duplicate, and
   missing-required-property counts.
4. Normalized campaign attribution joined to sessions and outcomes.
5. Reliable error rate denominators and affected-build/device context, rather
   than error counts alone.
