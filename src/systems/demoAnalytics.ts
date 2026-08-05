import { store } from "../state/store.ts";
import { analytics } from "./analytics/analyticsConfig.ts";
import { createLevelAnalytics } from "./levelAnalytics.ts";
import { runtimeServices } from "./runtimeServices.ts";

const DEMO_TARGET_SCORE = 10;

/** Guards `first_input` so a name that says "first" means it. Reset per run. */
let inputRecordedThisRun = false;

export const demoLevelAnalytics = createLevelAnalytics({
    emit: (eventName, payload) => runtimeServices.track(eventName, payload),
});

/**
 * ADAPT: this module is where the demo loop's beats become FTUE funnel steps.
 * Derived games rename the beats, but each one still fires its step here (or
 * from the equivalent run controller) rather than from a renderer or a React
 * effect — a step must mean "the player progressed", never "the save loaded".
 * `ftue` is once-ever, so re-entering a level cannot re-fire an earlier step.
 */
export function startDemoLevel(): void {
    inputRecordedThisRun = false;
    const state = store.get();
    // Steps 3 and 7 are the same call site: the once-ever marks make the
    // second press count as "came back for another round" on its own.
    analytics.funnelStep("ftue", state.totalPlays <= 1 ? 3 : 6, { play_number: state.totalPlays });
    demoLevelAnalytics.start({
        level_id: `template_demo_${state.level}`,
        level: state.level,
        mode: "bounce_demo",
        target_score: DEMO_TARGET_SCORE,
        play_number: state.totalPlays,
        quality: state.quality,
        reduced_motion: state.reducedMotion,
    });
}

/**
 * First core-verb interaction of the run. A plain event, not a funnel step: in
 * this demo the ball scores without being touched, so tap-vs-score order varies
 * per player and putting it in the funnel produced a non-monotonic curve.
 */
export function recordDemoInput(): void {
    if (inputRecordedThisRun) return;
    inputRecordedThisRun = true;
    analytics.event("first_input", { play_number: store.get().totalPlays });
}

/** First point scored — the first moment the game answers back. */
export function recordDemoScore(score: number): void {
    if (score === 1) analytics.funnelStep("ftue", 4, { score });
}

export function completeDemoLevel(score: number): void {
    // ADAPT: replace with this game's real progression beat (a personal best, a
    // world unlocked, a boss cleared). Milestones answer "did this session
    // matter to the player", which run_ended alone cannot. Read any previous
    // value BEFORE the store is updated, or the comparison is already gone.
    const state = store.get();
    if (score >= state.level * DEMO_TARGET_SCORE) {
        analytics.event("milestone_reached", { milestone: "level_target_met", value: score, level: state.level });
    }
    analytics.funnelStep("ftue", 5, { score });
    analytics.funnelStep("engagement", store.get().totalPlays, { score });
    demoLevelAnalytics.complete({
        score,
        target_score: DEMO_TARGET_SCORE,
    });
}

export function abandonDemoLevel(exitReason: string): void {
    demoLevelAnalytics.abandon(exitReason, { score: store.get().score });
}
