import { useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { PLATFORM_IDS } from "../config/platform.ts";
import { RUN_CAPABILITIES, type CapabilitySafety } from "../sdk/capabilityCatalog.ts";
import {
    addRunGameToHome,
    composeRunSocialPost,
    copyRuntimeText,
    inspectRunHost,
    inspectRunPlayerServices,
    openRunReleaseNotes,
    requestMemberSignIn,
    shareRunScore,
    showRunCommunityUi,
    showRunHostUi,
    type RunDemoResult,
} from "../sdk/featureLab.ts";
import { getRunCapabilities, type HapticStyle, type VerifiedActionResult } from "../sdk/runSdk.ts";
import { dailySystems } from "../systems/dailySystems.ts";
import { saveSystem } from "../systems/save.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { store, useStore } from "../state/store.ts";
import { formatNumber } from "../systems/localization.ts";
import MenuScreenLayout from "./MenuScreenLayout.tsx";

type BusyAction =
    | "rewarded"
    | "interstitial"
    | "haptic"
    | "host"
    | "signin"
    | "host-ui"
    | "release-notes"
    | "community"
    | "add-home"
    | "player-data"
    | "share"
    | "social"
    | "clipboard"
    | null;

const SAFETY_LABELS: Record<CapabilitySafety, string> = {
    "read-only": "READ",
    "configured-write": "CONFIG",
    "player-gesture": "ACTION",
    "paid-or-billed": "BILLED",
    privileged: "ADMIN",
    "server-only": "SERVER",
};

function resultCopy(result: VerifiedActionResult): string {
    if (result === "verified") return "HOST VERIFIED";
    if (result === "cancelled") return "CANCELLED — NO REWARD";
    if (result === "failed") return "HOST CALL FAILED — RECOVERABLE";
    return "UNAVAILABLE — CHECK HOST + LIVEOPS";
}

export default function RunFeaturesScreen() {
    useStore((state) => state.runtimeReady);
    const totalPlays = useStore((state) => state.totalPlays);
    const score = useStore((state) => state.score);
    const hapticsEnabled = useStore((state) => state.hapticsEnabled);
    const [busy, setBusy] = useState<BusyAction>(null);
    const [adStatus, setAdStatus] = useState("READY TO TEST — NEVER SIMULATES SUCCESS");
    const [hapticStatus, setHapticStatus] = useState("TAP A STYLE ON A SUPPORTED DEVICE");
    const [sdkStatus, setSdkStatus] = useState("CHOOSE AN ACTION — NOTHING RUNS AT STARTUP");
    const capabilities = getRunCapabilities();
    const runtimeConfig = runtimeServices.config;

    const openRenderingLab = () => store.patch({ menuScreen: "rendering-lab" });

    const testHaptic = async (style: HapticStyle) => {
        setBusy("haptic");
        const sent = await runtimeServices.haptic(style);
        setBusy(null);
        audioManager.play(sent ? "reward" : "error");
        setHapticStatus(sent ? `${style.toUpperCase()} FEEDBACK SENT` : "NO SUPPORTED/ENABLED HAPTIC OUTPUT");
    };

    const testRewarded = async () => {
        setBusy("rewarded");
        runtimeServices.track("ad_requested", { placementId: PLATFORM_IDS.rewardedResultsBonus, adType: "rewarded" });
        const result = await runtimeServices.watchResultsAd();
        if (result === "verified") {
            store.patch({ coins: store.get().coins + 100 });
            // Every coin source must feed the coins quest, or "EARN 100 COINS"
            // is uncompletable on days the daily reward pays less than 100.
            dailySystems.recordQuestProgress("coins", 100);
            await saveSystem.flush();
            audioManager.play("reward");
            void runtimeServices.haptic("success");
            runtimeServices.track("reward_granted", {
                placementId: PLATFORM_IDS.rewardedResultsBonus,
                rewardId: "coins",
                amount: 100,
            });
        } else {
            audioManager.play(result === "cancelled" ? "tap" : "error");
        }
        runtimeServices.track("ad_result", {
            placementId: PLATFORM_IDS.rewardedResultsBonus,
            adType: "rewarded",
            result,
        });
        setAdStatus(`REWARDED: ${resultCopy(result)}`);
        setBusy(null);
    };

    const testInterstitial = async () => {
        setBusy("interstitial");
        runtimeServices.track("ad_requested", {
            placementId: PLATFORM_IDS.featureLabInterstitial,
            adType: "interstitial",
        });
        const result = await runtimeServices.showFeatureLabInterstitial();
        runtimeServices.track("ad_result", {
            placementId: PLATFORM_IDS.featureLabInterstitial,
            adType: "interstitial",
            result,
        });
        audioManager.play(result === "verified" ? "reward" : result === "failed" ? "error" : "tap");
        setAdStatus(`INTERSTITIAL: ${resultCopy(result)}`);
        setBusy(null);
    };

    const runSdkDemo = async (
        action: Exclude<BusyAction, "rewarded" | "interstitial" | "haptic" | null>,
        task: () => Promise<RunDemoResult>,
    ) => {
        setBusy(action);
        try {
            const result = await task();
            setSdkStatus(result.message);
            audioManager.play(result.status === "verified" || result.status === "partial" ? "reward" : "error");
            if (result.status === "verified") void runtimeServices.haptic("success");
        } catch {
            setSdkStatus("SDK ACTION FAILED — RECOVERABLE");
            audioManager.play("error");
        } finally {
            setBusy(null);
        }
    };

    return (
        <MenuScreenLayout title="RUN FEATURES" kicker="VISIBLE / SAFE / OPT-IN">
            <p className="screen-copy">
                The starter maps every installed SDK capability without running paid, privileged, or remote mutations at
                startup.
            </p>

            <section className="feature-status-grid" aria-label="RUN connection status">
                <article>
                    <span>RUN HOST</span>
                    <strong>{capabilities.host ? "CONNECTED" : "LOCAL"}</strong>
                </article>
                <article>
                    <span>ADS API</span>
                    <strong>{capabilities.ads ? "AVAILABLE" : "NO HOST"}</strong>
                </article>
                <article>
                    <span>HAPTICS</span>
                    <strong>{capabilities.haptics ? "SUPPORTED" : "FALLBACK"}</strong>
                </article>
                <article>
                    <span>LIVEOPS ADS</span>
                    <strong>{runtimeConfig.adsEnabled ? "ENABLED" : "OFF"}</strong>
                </article>
            </section>

            <article className="feature-demo-card feature-demo-renderer">
                <div>
                    <p className="eyebrow">RENDERER ARCHITECTURE</p>
                    <h3>PIXI / THREE / HYBRID</h3>
                </div>
                <p>
                    Open two live, responsive references: a Three-only world with Three UI, and a Three world beneath a
                    transparent Pixi HUD.
                </p>
                <div className="feature-actions feature-actions-single">
                    <button type="button" disabled={busy !== null} onClick={openRenderingLab}>
                        OPEN RENDERING LAB
                    </button>
                </div>
            </article>

            <article className="feature-demo-card feature-demo-ad">
                <div>
                    <p className="eyebrow">AD MONETIZATION</p>
                    <h3>VERIFIED AD FLOWS</h3>
                </div>
                <p>
                    Rewarded grants {formatNumber(100)} demo coins only after the SDK returns true. Interstitial is an
                    explicit natural-break test.
                </p>
                <div className="feature-actions">
                    <button
                        type="button"
                        disabled={busy !== null || totalPlays === 0}
                        onClick={() => void testRewarded()}
                    >
                        {totalPlays === 0
                            ? "PLAY DEMO ONCE"
                            : busy === "rewarded"
                              ? "WAITING FOR HOST…"
                              : `TRY REWARDED +${formatNumber(100)}`}
                    </button>
                    <button
                        type="button"
                        disabled={busy !== null || totalPlays === 0}
                        onClick={() => void testInterstitial()}
                    >
                        {totalPlays === 0
                            ? "PLAY DEMO ONCE"
                            : busy === "interstitial"
                              ? "WAITING FOR HOST…"
                              : "TRY INTERSTITIAL"}
                    </button>
                </div>
                <output className="feature-output" aria-live="polite">
                    {adStatus}
                </output>
            </article>

            <article className="feature-demo-card feature-demo-haptic">
                <div>
                    <p className="eyebrow">DEVICE FEEDBACK</p>
                    <h3>HAPTIC PALETTE</h3>
                </div>
                <p>
                    Uses the SDK root haptic API and device capability flags; the player setting remains authoritative.
                </p>
                <div className="feature-actions feature-actions-three">
                    {(["light", "success", "warning"] as const).map((style) => (
                        <button
                            type="button"
                            key={style}
                            disabled={busy !== null || !hapticsEnabled}
                            onClick={() => void testHaptic(style)}
                        >
                            {style.toUpperCase()}
                        </button>
                    ))}
                </div>
                <output className="feature-output" aria-live="polite">
                    {hapticStatus}
                </output>
            </article>

            <article className="feature-demo-card feature-demo-sdk">
                <div>
                    <p className="eyebrow">HOST + PLAYER SERVICES</p>
                    <h3>SAFE SDK EXPLORER</h3>
                </div>
                <p>
                    Read platform state or open host-owned UI from an explicit tap. Data probes never buy, spend,
                    consume, grant, upload, or generate anything.
                </p>
                <div className="feature-actions feature-actions-sdk">
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void runSdkDemo("host", inspectRunHost)}
                    >
                        {busy === "host" ? "READING…" : "HOST SNAPSHOT"}
                    </button>
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void runSdkDemo("player-data", inspectRunPlayerServices)}
                    >
                        {busy === "player-data" ? "READING…" : "PLAYER DATA"}
                    </button>
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void runSdkDemo("signin", requestMemberSignIn)}
                    >
                        {busy === "signin" ? "WAITING…" : "MEMBER SIGN-IN"}
                    </button>
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void runSdkDemo("host-ui", showRunHostUi)}
                    >
                        {busy === "host-ui" ? "SHOWING…" : "LOADER + TOAST"}
                    </button>
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void runSdkDemo("release-notes", openRunReleaseNotes)}
                    >
                        {busy === "release-notes" ? "OPENING…" : "RELEASE NOTES"}
                    </button>
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void runSdkDemo("community", showRunCommunityUi)}
                    >
                        {busy === "community" ? "OPENING…" : "COMMUNITY UI"}
                    </button>
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void runSdkDemo("add-home", addRunGameToHome)}
                    >
                        {busy === "add-home" ? "WAITING…" : "ADD TO HOME"}
                    </button>
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void runSdkDemo("share", () => shareRunScore(score))}
                    >
                        {busy === "share" ? "SHARING…" : "SHARE SCORE"}
                    </button>
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void runSdkDemo("social", () => composeRunSocialPost(score))}
                    >
                        {busy === "social" ? "OPENING…" : "COMPOSE POST"}
                    </button>
                    <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void runSdkDemo("clipboard", () => copyRuntimeText(sdkStatus))}
                    >
                        {busy === "clipboard" ? "COPYING…" : "COPY STATUS"}
                    </button>
                </div>
                <output className="feature-output" aria-live="polite">
                    {sdkStatus}
                </output>
            </article>

            <details className="capability-drawer">
                <summary>ALL {formatNumber(RUN_CAPABILITIES.length)} SDK CAPABILITY GROUPS</summary>
                <div className="capability-list">
                    {RUN_CAPABILITIES.map((capability) => (
                        <article key={capability.id}>
                            <div>
                                <strong>{capability.id.replaceAll("-", " ").toUpperCase()}</strong>
                                <span data-safety={capability.safety}>{SAFETY_LABELS[capability.safety]}</span>
                            </div>
                            <p>{capability.summary}</p>
                            {"requires" in capability && capability.requires && (
                                <small>REQUIRES: {capability.requires}</small>
                            )}
                        </article>
                    ))}
                </div>
            </details>

            <p className="safety-note">
                Billed generation, currency spends, entitlement consumption, uploads, admin actions, navigation, and
                multiplayer stay in additional_features/ until a derived game deliberately adopts them.
            </p>
        </MenuScreenLayout>
    );
}
