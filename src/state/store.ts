/**
 * Global UI state for the template shell.
 *
 * This store intentionally mirrors the same shape you need for feature-rich
 * RUN prototypes: phase routing, selected menu screen, monetization badges,
 * settings, and a few gameplay counters shared between the React HUD and
 * Pixi scene.
 */
import { useSyncExternalStore } from "react";

export type MenuScreen =
    | "main"
    | "daily-rewards"
    | "daily-quests"
    | "shop"
    | "stats"
    | "run-features"
    | "rendering-lab"
    | "settings";

export interface AppState {
    /** Boot and navigation state */
    phase: "loading" | "menu" | "playing";
    /** Progress bar state while critical assets warm */
    loadProgress: number;
    /** Game is paused by host lifecycle */
    paused: boolean;
    /** Selected menu screen (inside phase === 'menu') */
    menuScreen: MenuScreen;

    /** Core gameplay counters shown in HUD / menus */
    score: number;
    coins: number;
    level: number;
    totalPlays: number;

    /** Player settings mirrored from save */
    musicEnabled: boolean;
    musicVolume: number;
    sfxEnabled: boolean;
    sfxVolume: number;
    notificationsEnabled: boolean;
    notificationsConsent: "unknown" | "granted" | "denied";
    hapticsEnabled: boolean;
    reducedMotion: boolean;
    locale: string;
    quality: "high" | "low";

    /** One-time toasts surfaced from systems/purchases/tutorials */
    toast: string | null;

    /** Retention state */
    dailyRewardLastClaimDay: string | null;
    dailyRewardStreak: number;
    dailyRewardClaimIds: string[];
    dailyQuestDay: string | null;
    dailyQuestProgress: Record<string, number>;
    dailyQuestClaimIds: string[];
    runtimeReady: boolean;
    runtimeConfigVersion: string | null;
    trustedTimeReady: boolean;
}

const listeners = new Set<() => void>();

let state: AppState = {
    phase: "loading",
    loadProgress: 0,
    paused: false,
    menuScreen: "main",

    score: 0,
    coins: 0,
    level: 1,
    totalPlays: 0,

    musicEnabled: true,
    musicVolume: 0.42,
    sfxEnabled: true,
    sfxVolume: 0.7,
    notificationsEnabled: false,
    notificationsConsent: "unknown",
    hapticsEnabled: true,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    locale: "English",
    quality: "high",

    toast: null,
    dailyRewardLastClaimDay: null,
    dailyRewardStreak: 0,
    dailyRewardClaimIds: [],
    dailyQuestDay: null,
    dailyQuestProgress: {},
    dailyQuestClaimIds: [],
    runtimeReady: false,
    runtimeConfigVersion: null,
    trustedTimeReady: false,
};

export const store = {
    get(): AppState {
        return state;
    },

    patch(partial: Partial<AppState>): void {
        state = { ...state, ...partial };
        for (const l of listeners) l();
    },

    subscribe(l: () => void): () => void {
        listeners.add(l);
        return () => listeners.delete(l);
    },
};

export function useStore<T = AppState>(selector: (s: AppState) => T = (s) => s as unknown as T): T {
    return useSyncExternalStore(store.subscribe, () => selector(state));
}
