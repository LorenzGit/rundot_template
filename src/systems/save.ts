import { getRunCapabilities, readAppStorage, writeAppStorage } from "../sdk/runSdk.ts";
import { store, type AppState, type PendingPurchaseIntentSnapshot } from "../state/store.ts";

const SAVE_KEY = "rundot_template-save";
const LEGACY_SAVE_KEYS = ["template-pixi-webgpu-save", "template-pixi-webgpu.save"] as const;
export const SAVE_VERSION = 3;

export interface GameSaveV3 {
    version: 3;
    settings: Pick<
        AppState,
        | "musicEnabled"
        | "musicVolume"
        | "sfxEnabled"
        | "sfxVolume"
        | "notificationsEnabled"
        | "notificationsConsent"
        | "hapticsEnabled"
        | "reducedMotion"
        | "locale"
        | "quality"
    >;
    progress: Pick<AppState, "score" | "coins" | "level" | "totalPlays">;
    retention: Pick<
        AppState,
        | "dailyRewardLastClaimDay"
        | "dailyRewardStreak"
        | "dailyRewardClaimIds"
        | "dailyQuestDay"
        | "dailyQuestProgress"
        | "dailyQuestClaimIds"
    >;
    /** v3: interrupted-checkout intent and the last authoritative ownership read */
    commerce: Pick<AppState, "pendingPurchaseIntent" | "ownedProductIds">;
}

export type SaveSource = "run" | "local" | "defaults";

function readLocalSave(): { key: string; value: string } | null {
    try {
        for (const key of [SAVE_KEY, ...LEGACY_SAVE_KEYS]) {
            const value = window.localStorage.getItem(key);
            if (value !== null) return { key, value };
        }
        return null;
    } catch (error) {
        console.warn("[save] local fallback read failed", error);
        return null;
    }
}

function clamp01(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

function enumOr<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function nonNegativeInteger(value: unknown, fallback = 0): number {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(number))) : fallback;
}

function dayKeyOrNull(value: unknown): string | null {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function recentStrings(value: unknown, limit: number): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is string => typeof entry === "string" && entry.length <= 160).slice(-limit);
}

function productIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((entry): entry is string => typeof entry === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(entry))
        .slice(0, 64);
}

/** A malformed intent is dropped whole: a partial one could never reconcile. */
function pendingIntentOrNull(value: unknown): PendingPurchaseIntentSnapshot | null {
    if (!value || typeof value !== "object") return null;
    const intent = value as Partial<PendingPurchaseIntentSnapshot>;
    return typeof intent.productId === "string" &&
        intent.productId.length > 0 &&
        typeof intent.catalogItemId === "string" &&
        intent.catalogItemId.length > 0 &&
        typeof intent.idempotencyKey === "string" &&
        intent.idempotencyKey.length > 0 &&
        intent.idempotencyKey.length <= 160 &&
        Number.isFinite(intent.startedAt)
        ? {
              productId: intent.productId,
              catalogItemId: intent.catalogItemId,
              idempotencyKey: intent.idempotencyKey,
              startedAt: nonNegativeInteger(intent.startedAt),
          }
        : null;
}

function snapshot(): GameSaveV3 {
    const state = store.get();
    return {
        version: SAVE_VERSION,
        settings: {
            musicEnabled: state.musicEnabled,
            musicVolume: state.musicVolume,
            sfxEnabled: state.sfxEnabled,
            sfxVolume: state.sfxVolume,
            notificationsEnabled: state.notificationsEnabled,
            notificationsConsent: state.notificationsConsent,
            hapticsEnabled: state.hapticsEnabled,
            reducedMotion: state.reducedMotion,
            locale: state.locale,
            quality: state.quality,
        },
        progress: {
            score: state.score,
            coins: state.coins,
            level: state.level,
            totalPlays: state.totalPlays,
        },
        retention: {
            dailyRewardLastClaimDay: state.dailyRewardLastClaimDay,
            dailyRewardStreak: state.dailyRewardStreak,
            dailyRewardClaimIds: state.dailyRewardClaimIds,
            dailyQuestDay: state.dailyQuestDay,
            dailyQuestProgress: state.dailyQuestProgress,
            dailyQuestClaimIds: state.dailyQuestClaimIds,
        },
        commerce: {
            pendingPurchaseIntent: state.pendingPurchaseIntent,
            ownedProductIds: state.ownedProductIds,
        },
    };
}

function migrate(raw: unknown): GameSaveV3 | null {
    if (!raw || typeof raw !== "object") return null;
    const candidate = raw as Omit<Partial<GameSaveV3>, "version"> & { version?: number };
    if (
        (candidate.version !== 1 && candidate.version !== 2 && candidate.version !== SAVE_VERSION) ||
        !candidate.settings ||
        !candidate.progress
    )
        return null;
    const defaults = snapshot();
    const retention =
        candidate.retention && typeof candidate.retention === "object" ? candidate.retention : defaults.retention;
    // v2 → v3 back-fill: older saves simply have no commerce record yet.
    const commerce =
        candidate.commerce && typeof candidate.commerce === "object" ? candidate.commerce : defaults.commerce;
    return {
        version: SAVE_VERSION,
        settings: {
            musicEnabled: booleanOr(candidate.settings.musicEnabled, defaults.settings.musicEnabled),
            musicVolume: clamp01(candidate.settings.musicVolume, defaults.settings.musicVolume),
            sfxEnabled: booleanOr(candidate.settings.sfxEnabled, defaults.settings.sfxEnabled),
            sfxVolume: clamp01(candidate.settings.sfxVolume, defaults.settings.sfxVolume),
            hapticsEnabled: booleanOr(candidate.settings.hapticsEnabled, defaults.settings.hapticsEnabled),
            reducedMotion: booleanOr(candidate.settings.reducedMotion, defaults.settings.reducedMotion),
            locale: enumOr(
                candidate.settings.locale,
                ["English", "PortugueseBR", "SpanishLA"] as const,
                defaults.settings.locale,
            ),
            quality: enumOr(candidate.settings.quality, ["high", "low"] as const, defaults.settings.quality),
            notificationsConsent: enumOr(
                candidate.settings.notificationsConsent,
                ["unknown", "granted", "denied"] as const,
                defaults.settings.notificationsConsent,
            ),
            notificationsEnabled:
                candidate.settings.notificationsConsent === "granted" &&
                candidate.settings.notificationsEnabled === true,
        },
        progress: {
            score: nonNegativeInteger(candidate.progress.score),
            coins: nonNegativeInteger(candidate.progress.coins),
            level: Math.max(1, nonNegativeInteger(candidate.progress.level, 1)),
            totalPlays: nonNegativeInteger(candidate.progress.totalPlays),
        },
        retention: {
            dailyRewardLastClaimDay: dayKeyOrNull(retention.dailyRewardLastClaimDay),
            dailyRewardStreak: nonNegativeInteger(retention.dailyRewardStreak),
            dailyRewardClaimIds: recentStrings(retention.dailyRewardClaimIds, 90),
            dailyQuestDay: dayKeyOrNull(retention.dailyQuestDay),
            dailyQuestProgress:
                retention.dailyQuestProgress && typeof retention.dailyQuestProgress === "object"
                    ? Object.fromEntries(
                          Object.entries(retention.dailyQuestProgress)
                              .filter(
                                  ([key, value]) =>
                                      ["bounces", "plays", "coins"].includes(key) &&
                                      typeof value === "number" &&
                                      Number.isFinite(value),
                              )
                              .map(([key, value]) => [key, nonNegativeInteger(value)]),
                      )
                    : {},
            dailyQuestClaimIds: recentStrings(retention.dailyQuestClaimIds, 180),
        },
        commerce: {
            pendingPurchaseIntent: pendingIntentOrNull(commerce.pendingPurchaseIntent),
            ownedProductIds: productIds(commerce.ownedProductIds),
        },
    };
}

function parse(raw: string | null): GameSaveV3 | null {
    if (!raw) return null;
    try {
        return migrate(JSON.parse(raw));
    } catch {
        return null;
    }
}

function apply(save: GameSaveV3): void {
    store.patch({ ...save.settings, ...save.progress, ...save.retention, ...save.commerce });
}

let lastSaved = "";
let pendingSave: string | null = null;
let flushInFlight: Promise<boolean> | null = null;

function usesRunStorage(): boolean {
    const capabilities = getRunCapabilities();
    return capabilities.host && !capabilities.mock;
}

async function persist(serialized: string): Promise<boolean> {
    if (usesRunStorage()) return writeAppStorage(SAVE_KEY, serialized);
    try {
        window.localStorage.setItem(SAVE_KEY, serialized);
        return true;
    } catch (error) {
        console.warn("[save] local fallback write failed", error);
        return false;
    }
}

export const saveSystem = {
    async load(): Promise<SaveSource> {
        if (!usesRunStorage()) {
            const stored = readLocalSave();
            const save = parse(stored?.value ?? null);
            if (save) apply(save);
            lastSaved = JSON.stringify(snapshot());
            if (save && stored?.key !== SAVE_KEY) {
                try {
                    window.localStorage.setItem(SAVE_KEY, lastSaved);
                } catch (error) {
                    console.warn("[save] local key migration failed", error);
                }
            }
            return save ? "local" : "defaults";
        }

        for (const key of [SAVE_KEY, ...LEGACY_SAVE_KEYS]) {
            const remote = await readAppStorage(key);
            if (!remote.ok) return "defaults";
            const save = parse(remote.value);
            if (!save) continue;

            apply(save);
            lastSaved = JSON.stringify(snapshot());
            if (key !== SAVE_KEY) await writeAppStorage(SAVE_KEY, lastSaved);
            return "run";
        }

        lastSaved = JSON.stringify(snapshot());
        return "defaults";
    },

    async flush(): Promise<boolean> {
        const serialized = JSON.stringify(snapshot());
        if (serialized === lastSaved && pendingSave === null) return true;
        pendingSave = serialized;
        if (flushInFlight) return flushInFlight;

        // Serialize remote writes and coalesce rapid settings/gameplay changes.
        // An older, slower RPC can never complete after and overwrite a newer one.
        flushInFlight = (async () => {
            let allSucceeded = true;
            while (pendingSave !== null) {
                const next = pendingSave;
                pendingSave = null;
                if (next === lastSaved) continue;
                const saved = await persist(next);
                if (saved) lastSaved = next;
                else allSucceeded = false;
            }
            return allSucceeded;
        })().finally(() => {
            flushInFlight = null;
        });
        return flushInFlight;
    },
};
