import { store } from "../state/store.ts";
import { createLevelAnalytics } from "./levelAnalytics.ts";
import { runtimeServices } from "./runtimeServices.ts";

const DEMO_TARGET_SCORE = 10;

export const demoLevelAnalytics = createLevelAnalytics({
    emit: (eventName, payload) => runtimeServices.track(eventName, payload),
});

export function startDemoLevel(): void {
    const state = store.get();
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

export function completeDemoLevel(score: number): void {
    demoLevelAnalytics.complete({
        score,
        target_score: DEMO_TARGET_SCORE,
    });
}

export function abandonDemoLevel(exitReason: string): void {
    demoLevelAnalytics.abandon(exitReason, { score: store.get().score });
}
