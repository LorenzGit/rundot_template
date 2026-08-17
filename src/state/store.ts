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

/** A checkout the host may still be settling; keyed by its idempotency key. */
export interface PendingPurchaseIntentSnapshot {
    productId: string;
    catalogItemId: string;
    idempotencyKey: string;
    startedAt: number;
}

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
    /** Lifetime best of `score` — the record Stats shows; persisted in the save. */
    bestScore: number;
    coins: number;
    level: number;
    totalPlays: number;

    /** Player settings mirrored from save */
    musicEnabled: boolean;
    musicVolume: number;
    sfxEnabled: boolean;
    sfxVolume: number;
    /** Derived each boot from the host permission and the opt-out below. */
    notificationsEnabled: boolean;
    /**
     * The player's own "not in this game" choice, set only from Settings.
     * Separate from the host permission because that permission is shared by
     * every RUN game: turning reminders off here must not silence the others.
     */
    notificationsOptOut: boolean;
    notificationsConsent: "unknown" | "granted" | "denied";
    hapticsEnabled: boolean;
    reducedMotion: boolean;
    locale: string;
    quality: "high" | "low";

    /** One-time toasts surfaced from systems/purchases/tutorials */
    toast: string | null;
    /**
     * Bumped every time a toast is SET (see store.patch). Keying on the text
     * alone breaks when the same message fires twice: the snapshot compares
     * equal, React skips the re-render, and the first timer kills the second.
     */
    toastSeq: number;

    /** Commerce state mirrored from save */
    pendingPurchaseIntent: PendingPurchaseIntentSnapshot | null;
    /** Last authoritative entitlement read; a failed read never clears this */
    ownedProductIds: string[];

    /** Retention state */
    dailyRewardLastClaimDay: string | null;
    dailyRewardStreak: number;
    dailyRewardClaimIds: string[];
    dailyQuestDay: string | null;
    dailyQuestProgress: Record<string, number>;
    dailyQuestClaimIds: string[];
    /** Once-ever analytics marks must live in host-backed save, not iframe localStorage. */
    analyticsFunnelMarks: string[];
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
    bestScore: 0,
    coins: 0,
    level: 1,
    totalPlays: 0,

    musicEnabled: true,
    musicVolume: 0.42,
    sfxEnabled: true,
    sfxVolume: 0.7,
    notificationsEnabled: false,
    notificationsOptOut: false,
    notificationsConsent: "unknown",
    hapticsEnabled: true,
    reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    locale: "English",
    quality: "high",

    toast: null,
    toastSeq: 0,
    pendingPurchaseIntent: null,
    ownedProductIds: [],
    dailyRewardLastClaimDay: null,
    dailyRewardStreak: 0,
    dailyRewardClaimIds: [],
    dailyQuestDay: null,
    dailyQuestProgress: {},
    dailyQuestClaimIds: [],
    analyticsFunnelMarks: [],
    runtimeReady: false,
    runtimeConfigVersion: null,
    trustedTimeReady: false,
};

export const store = {
    get(): AppState {
        return state;
    },

    patch(partial: Partial<AppState>): void {
        // Stamp toastSeq whenever a toast is set so every producer gets the
        // repeat-safe behavior without changing its call site.
        state =
            typeof partial.toast === "string"
                ? { ...state, ...partial, toastSeq: state.toastSeq + 1 }
                : { ...state, ...partial };
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
