# Browser visual regression contract

Use this pattern for games where a production release needs reproducible visual
and behavioral evidence beyond a build passing. Tower Defense demonstrates it in
`tower-defense/scripts/visual-qa.mjs`; do not copy its game-specific coordinates
or state names into another game.

## Add a test-only game contract

When the URL contains a development-only `qa=1` flag, expose a small,
non-production global such as `globalThis.__gameQa`:

```ts
type GameQa = {
  snapshot(): Record<string, unknown>
  startRun(): Promise<void> | void
  reset(): Promise<void> | void
  // Add semantic actions only for important game states.
}
```

Never expose this in production builds or use it as a player/admin control. Its
actions must be semantic (for example `startRun`, `claimDailyReward`,
`openSettings`), not brittle canvas coordinates.

## Write a browser-driven audit

Use Chrome DevTools Protocol or an established browser test runner to:

1. Start a local production-like build at declared phone, tablet, and desktop
   viewports/DPRs.
2. Fail on unhandled exceptions and console errors, except documented expected
   mock-host warnings.
3. Drive the QA contract and real input through the first session, core loop,
   failure/retry, save/reload, settings, monetization surfaces, and relevant
   feature states.
4. Capture named screenshots at stable checkpoints. Store only intentional
   release evidence or compare against approved baselines with a reviewed
   tolerance; do not accumulate unreviewed screenshots forever.
5. Assert meaningful state: no duplicate reward, persisted setting, music/audio
   pause/resume, expected UI visibility, correct asset loaded, and no broken
   layout—not merely that a screenshot exists.

Record command, commit/version, viewport, test data/reset method, screenshots,
and failures in the release evidence. Keep host-only/payment/multiplayer checks
separate and label them as requiring real RUN conditions.
