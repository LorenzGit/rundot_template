import packageJson from "../../package.json";
import { PLATFORM_IDS, isConfiguredPlatformId } from "../config/platform.ts";
import {
    fetchLiveOps,
    getRunCapabilities,
    purchaseVerifiedShopItem,
    rearmLocalNotification,
    recordAnalytics,
    recordFunnelStep,
    showVerifiedRewardedAd,
    showVerifiedInterstitialAd,
    triggerHaptic,
    type HapticStyle,
    type VerifiedActionResult,
} from "../sdk/runSdk.ts";
import { refreshServerTime } from "./serverTime.ts";
import { store } from "../state/store.ts";
import { t } from "./localization.ts";

export interface RuntimeConfig {
    dailyRewardsEnabled: boolean;
    dailyQuestsEnabled: boolean;
    notificationDelaySeconds: number;
    adsEnabled: boolean;
    shopEnabled: boolean;
}

const DEFAULTS: Readonly<RuntimeConfig> = Object.freeze({
    dailyRewardsEnabled: true,
    dailyQuestsEnabled: true,
    notificationDelaySeconds: 86_400,
    adsEnabled: false,
    shopEnabled: false,
});

const RETURN_REMINDER_ID = "rundot-template-return-reminder";
const LEGACY_RETURN_REMINDER_ID = "template-pixi-return-reminder";

let config: RuntimeConfig = { ...DEFAULTS };
let nextRefreshTimer = 0;

function clearScheduledRefresh(): void {
    if (!nextRefreshTimer) return;
    window.clearTimeout(nextRefreshTimer);
    nextRefreshTimer = 0;
}

function normalize(values: Record<string, unknown>): RuntimeConfig {
    const root =
        values.runtime && typeof values.runtime === "object" ? (values.runtime as Record<string, unknown>) : values;
    const monetization =
        root.monetization && typeof root.monetization === "object"
            ? (root.monetization as Record<string, unknown>)
            : {};
    const delay = Number(root.notificationDelaySeconds);
    return {
        dailyRewardsEnabled: typeof root.dailyRewardsEnabled === "boolean" ? root.dailyRewardsEnabled : true,
        dailyQuestsEnabled: typeof root.dailyQuestsEnabled === "boolean" ? root.dailyQuestsEnabled : true,
        notificationDelaySeconds: Number.isFinite(delay) ? Math.max(3_600, Math.min(delay, 604_800)) : 86_400,
        adsEnabled: monetization.adsEnabled === true && isConfiguredPlatformId(PLATFORM_IDS.rewardedResultsBonus),
        shopEnabled:
            monetization.shopEnabled === true &&
            isConfiguredPlatformId(PLATFORM_IDS.starterBundleItem) &&
            isConfiguredPlatformId(PLATFORM_IDS.starterBundleEntitlement),
    };
}

async function refreshLiveOps(): Promise<void> {
    clearScheduledRefresh();
    const snapshot = await fetchLiveOps();
    if (!snapshot) {
        config = { ...DEFAULTS };
        store.patch({ runtimeReady: true, runtimeConfigVersion: null });
        return;
    }
    config = normalize(snapshot.values);
    store.patch({ runtimeReady: true, runtimeConfigVersion: snapshot.configVersion });
    if (snapshot.nextChangeAt) {
        const delay = Math.max(1_000, Math.min(snapshot.nextChangeAt - Date.now() + 500, 2_147_000_000));
        nextRefreshTimer = window.setTimeout(() => startRefreshCycle(), delay);
    }
}

async function refreshTime(): Promise<void> {
    store.patch({ trustedTimeReady: await refreshServerTime() });
}

async function rearmNotifications(): Promise<void> {
    const state = store.get();
    if (!state.notificationsEnabled || state.notificationsConsent !== "granted") return;
    await rearmLocalNotification({
        id: RETURN_REMINDER_ID,
        legacyIds: [LEGACY_RETURN_REMINDER_ID],
        title: t("NotificationTitle"),
        body: t("NotificationReEngagementBody"),
        delaySeconds: config.notificationDelaySeconds,
    });
}

async function refreshRuntime(): Promise<void> {
    await Promise.allSettled([refreshTime(), refreshLiveOps()]);
    await rearmNotifications();
}

function startRefreshCycle(): void {
    void refreshRuntime().catch((error) => {
        console.warn("[runtime] background refresh failed", error);
    });
}

export const runtimeServices = {
    get config(): Readonly<RuntimeConfig> {
        return config;
    },
    bootstrap(): void {
        startRefreshCycle();
        this.track("game_boot", { version: packageJson.version, host: getRunCapabilities().host });
    },
    resume(): void {
        startRefreshCycle();
    },
    rearmNotifications(): void {
        void rearmNotifications().catch((error) => {
            console.warn("[runtime] notification refresh failed", error);
        });
    },
    track(eventName: string, payload: Record<string, unknown> = {}): void {
        void recordAnalytics(eventName, { ...payload, build_version: packageJson.version });
    },
    funnel(step: number, name: string, funnel: string, funnelOrder = 0): void {
        void recordFunnelStep(step, name, funnel, funnelOrder);
    },
    async haptic(style: HapticStyle): Promise<boolean> {
        return store.get().hapticsEnabled ? triggerHaptic(style) : false;
    },
    async watchResultsAd(): Promise<VerifiedActionResult> {
        if (store.get().totalPlays < 1) return "unavailable";
        if (!config.adsEnabled || !isConfiguredPlatformId(PLATFORM_IDS.rewardedResultsBonus)) return "unavailable";
        return showVerifiedRewardedAd(PLATFORM_IDS.rewardedResultsBonus, "Results Bonus");
    },
    async showFeatureLabInterstitial(): Promise<VerifiedActionResult> {
        if (store.get().totalPlays < 1) return "unavailable";
        if (!config.adsEnabled || !isConfiguredPlatformId(PLATFORM_IDS.featureLabInterstitial)) return "unavailable";
        return showVerifiedInterstitialAd(PLATFORM_IDS.featureLabInterstitial, "Feature Lab Natural Break");
    },
    async purchaseStarterBundle(idempotencyKey: string): Promise<VerifiedActionResult> {
        if (!config.shopEnabled || !isConfiguredPlatformId(PLATFORM_IDS.starterBundleItem)) return "unavailable";
        return purchaseVerifiedShopItem(PLATFORM_IDS.starterBundleItem, idempotencyKey);
    },
};
