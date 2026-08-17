import packageJson from "../../package.json";
import { PLATFORM_IDS, isConfiguredPlatformId } from "../config/platform.ts";
import {
    fetchLiveOps,
    getRunCapabilities,
    purchaseVerifiedShopItem,
    cancelLocalNotification,
    readNotificationPermission,
    recordAnalytics,
    showVerifiedRewardedAd,
    showVerifiedInterstitialAd,
    triggerHaptic,
    type HapticStyle,
    type ShopCheckoutResult,
    type VerifiedActionResult,
} from "../sdk/runSdk.ts";
import { refreshServerTime } from "./serverTime.ts";
import { store } from "../state/store.ts";
import { returnReminders } from "./retention/retentionConfig.ts";

export interface RuntimeConfig {
    dailyRewardsEnabled: boolean;
    dailyQuestsEnabled: boolean;
    adsEnabled: boolean;
    shopEnabled: boolean;
}

// The return-reminder cadence is deliberately NOT remoteable: it is fixed at
// 24/48/72h in returnReminders.ts. A parsed-but-unused delay knob sat here for
// a while and misled LiveOps operators into "tuning" a value nothing read.
const DEFAULTS: Readonly<RuntimeConfig> = Object.freeze({
    dailyRewardsEnabled: true,
    dailyQuestsEnabled: true,
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
    return {
        dailyRewardsEnabled: typeof root.dailyRewardsEnabled === "boolean" ? root.dailyRewardsEnabled : true,
        dailyQuestsEnabled: typeof root.dailyQuestsEnabled === "boolean" ? root.dailyQuestsEnabled : true,
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
        // KEEP the live config on a failed fetch: resetting to DEFAULTS here
        // yanked an enabled shop/ads surface for the rest of the session on a
        // single resume-time network blip. Retry only where a host could
        // actually answer — without the capability this null is permanent.
        store.patch({ runtimeReady: true });
        if (getRunCapabilities().liveops) {
            nextRefreshTimer = window.setTimeout(() => startRefreshCycle(), 60_000);
        }
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

/**
 * Re-anchor the whole 24/48/72h return cadence to now.
 *
 * This replaced a single 24h reminder. One ping gives a player exactly one
 * chance to come back; a short cadence gives three without becoming spam, and
 * stopping at 72h is deliberate — a fourth converts nobody and costs the
 * notification permission the first three depend on.
 */
async function rearmNotifications(): Promise<void> {
    // The RUN app owns notification permission and shares it across every game,
    // so a player who allowed it anywhere has allowed it here. Read that state
    // (silently — only the setter prompts) instead of requiring a visit to a
    // Settings screen almost nobody opens.
    const granted = await readNotificationPermission();
    const state = store.get();
    store.patch({
        notificationsEnabled: granted && !state.notificationsOptOut,
        // A refused ask stays "denied" so Settings can offer OFF rather than
        // ASK; anything else the host reports as off is simply not-yet-asked.
        notificationsConsent: granted ? "granted" : state.notificationsConsent === "denied" ? "denied" : "unknown",
    });
    // Only the player's own opt-out stops the cadence. Scheduling without the
    // host permission is a no-op, so gating on it would buy nothing and would
    // silence every player whose grant lands after this read.
    if (state.notificationsOptOut) return;
    // The pre-cadence reminder used its own id; leave it scheduled and the
    // player gets the old generic ping alongside the new specific ones.
    for (const legacy of [RETURN_REMINDER_ID, LEGACY_RETURN_REMINDER_ID]) {
        await cancelLocalNotification(legacy);
    }
    await returnReminders.refreshAll();
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
    async haptic(style: HapticStyle): Promise<boolean> {
        return store.get().hapticsEnabled ? triggerHaptic(style) : false;
    },
    async watchResultsAd(): Promise<VerifiedActionResult> {
        if (store.get().totalPlays < 1) return "unavailable";
        if (!config.adsEnabled || !isConfiguredPlatformId(PLATFORM_IDS.rewardedResultsBonus)) return "unavailable";
        // Offered and complete are both required: offered-without-complete is a
        // reward-or-copy problem, no-offer-at-all is an inventory one, and only
        // the pair tells them apart. Only a verified result earned the reward —
        // "cancelled" means the player closed the video early.
        this.track("rewarded_ad_offered", {
            ad_display_id: PLATFORM_IDS.rewardedResultsBonus,
            placement: "results_bonus",
        });
        const result = await showVerifiedRewardedAd(PLATFORM_IDS.rewardedResultsBonus, "Results Bonus");
        if (result === "verified") {
            this.track("rewarded_ad_complete", {
                ad_display_id: PLATFORM_IDS.rewardedResultsBonus,
                placement: "results_bonus",
            });
        }
        return result;
    },
    async showFeatureLabInterstitial(): Promise<VerifiedActionResult> {
        if (store.get().totalPlays < 1) return "unavailable";
        if (!config.adsEnabled || !isConfiguredPlatformId(PLATFORM_IDS.featureLabInterstitial)) return "unavailable";
        const result = await showVerifiedInterstitialAd(
            PLATFORM_IDS.featureLabInterstitial,
            "Feature Lab Natural Break",
        );
        // Interstitial load is the number to watch against D1 when tuning ads.
        if (result === "verified") {
            this.track("interstitial_shown", { ad_display_id: PLATFORM_IDS.featureLabInterstitial });
        }
        return result;
    },
    /**
     * ADAPT: prefer `purchaseProduct` in systems/monetization/commerce.ts —
     * it runs the checkout through the purchase coordinator, so an interrupted
     * order is reconciled instead of stranded. This is the raw one-shot call.
     */
    async purchaseStarterBundle(idempotencyKey: string): Promise<ShopCheckoutResult> {
        if (!config.shopEnabled || !isConfiguredPlatformId(PLATFORM_IDS.starterBundleItem)) {
            return { result: "unavailable" };
        }
        return purchaseVerifiedShopItem(PLATFORM_IDS.starterBundleItem, idempotencyKey);
    },
};
