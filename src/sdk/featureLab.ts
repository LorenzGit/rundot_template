/**
 * Player-triggered SDK demonstrations used by the RUN Feature Lab.
 *
 * Nothing in this module runs during startup. Read probes are independent so
 * one unconfigured service cannot hide the services that are available, and
 * every host call is bounded or wrapped in a recoverable result.
 */
import RundotGameAPI from "@series-inc/rundot-game-sdk/api";
import { getRunCapabilities, withTimeout } from "./runSdk.ts";
import { formatNumber } from "../systems/localization.ts";

import { analytics } from "../systems/analytics/analyticsConfig.ts";
export type RunDemoStatus = "verified" | "partial" | "unavailable" | "cancelled" | "failed";

export interface RunDemoResult {
    status: RunDemoStatus;
    message: string;
}

interface ProbeResult {
    ok: boolean;
    detail: string;
}

const READ_TIMEOUT_MS = 4_000;
const INTERACTIVE_TIMEOUT_MS = 90_000;

function unavailable(message = "RUN HOST REQUIRED"): RunDemoResult {
    return { status: "unavailable", message };
}

function failure(message: string): RunDemoResult {
    return { status: "failed", message };
}

function hostAvailable(): boolean {
    return getRunCapabilities().host;
}

function catchVoid(result: unknown, label: string): void {
    if (result === null || (typeof result !== "object" && typeof result !== "function")) return;
    const thenable = result as { catch?: (handler: (error: unknown) => void) => unknown };
    if (typeof thenable.catch === "function") {
        thenable.catch((error) => console.warn(`[featureLab] ${label} failed`, error));
    }
}

async function probe<T>(
    label: string,
    operation: () => T | Promise<T>,
    summarize: (value: T) => string,
): Promise<ProbeResult> {
    try {
        const value = await withTimeout(Promise.resolve().then(operation), READ_TIMEOUT_MS, label);
        return { ok: true, detail: summarize(value) };
    } catch {
        return { ok: false, detail: `${label.toUpperCase()} UNAVAILABLE` };
    }
}

function summarizeProbes(probes: ProbeResult[], prefix: string): RunDemoResult {
    const available = probes.filter((result) => result.ok);
    if (available.length === 0) return failure(`${prefix}: NO SERVICE READS COMPLETED`);
    const status = available.length === probes.length ? "verified" : "partial";
    return {
        status,
        message: `${prefix}: ${available.map((result) => result.detail).join(" · ")} · ${formatNumber(available.length)}/${formatNumber(probes.length)}`,
    };
}

export async function inspectRunHost(): Promise<RunDemoResult> {
    if (!hostAvailable()) return unavailable();

    const accessTier = (() => {
        try {
            return String(RundotGameAPI.accessGate.getAccessTier()).toUpperCase();
        } catch {
            return "UNKNOWN";
        }
    })();
    const locale = (() => {
        try {
            return RundotGameAPI.getLocale();
        } catch {
            return "UNKNOWN";
        }
    })();

    const probes = await Promise.all([
        probe(
            "profile",
            () => RundotGameAPI.getProfile(),
            (profile) => `PROFILE ${profile.id ? "READY" : "ANON"}`,
        ),
        probe(
            "system",
            () => ({
                device: RundotGameAPI.system.getDevice(),
                environment: RundotGameAPI.system.getEnvironment(),
                safeArea: RundotGameAPI.system.getSafeArea(),
            }),
            () => "SYSTEM",
        ),
        probe(
            "app role",
            () => RundotGameAPI.app.getMyRole(),
            (role) => `ROLE ${role.toUpperCase()}`,
        ),
        probe(
            "gamepad",
            async () => {
                await RundotGameAPI.gamepad.ready();
                return RundotGameAPI.gamepad.isSupported() ? RundotGameAPI.gamepad.getGamepads().length : 0;
            },
            (count) => `${formatNumber(count)} PADS`,
        ),
        probe(
            "attribution",
            () => RundotGameAPI.attribution.getAttributionParams(),
            () => "ATTRIBUTION",
        ),
        probe(
            "launch intent",
            () => RundotGameAPI.app.resolveLaunchIntent({ maxWaitMs: 1_000 }),
            (intent) => `LAUNCH ${intent.kind.toUpperCase()}`,
        ),
        probe(
            "release notes",
            () => RundotGameAPI.app.getReleaseNotesAsync(),
            (notes) => `${formatNumber(notes.length)} NOTES`,
        ),
        probe(
            "trusted time",
            () => RundotGameAPI.requestTimeAsync(),
            ({ serverTime }) => `TIME ${RundotGameAPI.formatTime(serverTime, {})}`,
        ),
        probe(
            "future time",
            () => RundotGameAPI.getFutureTimeAsync({ hours: 1 }),
            (timestamp) => `RESET ${RundotGameAPI.formatTime(timestamp, { timeStyle: "short" })}`,
        ),
        probe(
            "feature controls",
            async () => {
                const [flag, gate] = await Promise.all([
                    RundotGameAPI.getFeatureFlag({ flagName: "template_feature_lab" }),
                    RundotGameAPI.getFeatureGate({ gateName: "template_feature_lab" }),
                ]);
                // Reading a variant only produces useful data if the exposure is
                // recorded: without it there is no way to compare behaviour
                // between the players who got each branch.
                analytics.event("feature_flag_read", { flag: "template_feature_lab", enabled: flag === true });
                analytics.experimentExposure({
                    name: "template_feature_lab",
                    variant: String(gate),
                    group: flag === true ? "enabled" : "disabled",
                });
                return [flag, gate];
            },
            () => "FLAGS",
        ),
        probe(
            "large numbers",
            () => RundotGameAPI.numbers.calculateGeometricSeriesCost("1000000000000000000", 1.15, 25, 10),
            (value) => `BIG ${RundotGameAPI.numbers.format.incremental(value)}`,
        ),
        probe(
            "cdn",
            () => RundotGameAPI.cdn.resolveSharedLibUrl("react"),
            () => "CDN",
        ),
    ]);

    const summary = summarizeProbes(probes, `TIER ${accessTier} · ${locale.toUpperCase()}`);
    try {
        catchVoid(
            RundotGameAPI.log("RUN Feature Lab host snapshot", {
                completedReads: probes.filter((item) => item.ok).length,
            }),
            "host log",
        );
    } catch {
        // Host logging is diagnostic only; it must never change the result.
    }
    return summary;
}

export async function requestMemberSignIn(): Promise<RunDemoResult> {
    if (!hostAvailable()) return unavailable();
    try {
        if (RundotGameAPI.accessGate.getAccessTier() !== "anonymous") {
            return { status: "verified", message: "MEMBER ACCESS ALREADY ACTIVE" };
        }
        await withTimeout(RundotGameAPI.accessGate.promptLogin(), INTERACTIVE_TIMEOUT_MS, "member sign-in");
        return {
            status: RundotGameAPI.accessGate.getAccessTier() === "anonymous" ? "cancelled" : "verified",
            message:
                RundotGameAPI.accessGate.getAccessTier() === "anonymous"
                    ? "SIGN-IN DISMISSED"
                    : "MEMBER ACCESS VERIFIED",
        };
    } catch {
        return failure("SIGN-IN FAILED — RECOVERABLE");
    }
}

export async function showRunHostUi(): Promise<RunDemoResult> {
    if (!hostAvailable()) return unavailable();
    try {
        await withTimeout(RundotGameAPI.preloader.showLoadScreen(), READ_TIMEOUT_MS, "preloader.show");
        try {
            // Bounded like every other host call: an unresolved bridge here
            // would keep the native loader covering the game indefinitely.
            await withTimeout(
                RundotGameAPI.preloader.setLoaderText("RUN host UI connected"),
                READ_TIMEOUT_MS,
                "preloader.text",
            );
            await withTimeout(RundotGameAPI.preloader.setLoaderProgress(1), READ_TIMEOUT_MS, "preloader.progress");
        } finally {
            await withTimeout(RundotGameAPI.preloader.hideLoadScreen(), READ_TIMEOUT_MS, "preloader.hide");
        }
        await withTimeout(
            RundotGameAPI.popups.showToast("RUN host UI is connected", { variant: "success" }),
            READ_TIMEOUT_MS,
            "popups.showToast",
        );
        return { status: "verified", message: "NATIVE LOADER + TOAST SHOWN" };
    } catch {
        return failure("HOST UI FAILED — RECOVERABLE");
    }
}

export async function openRunReleaseNotes(): Promise<RunDemoResult> {
    if (!hostAvailable()) return unavailable();
    try {
        await withTimeout(RundotGameAPI.app.openReleaseNotesAsync(), INTERACTIVE_TIMEOUT_MS, "release notes");
        return { status: "verified", message: "RELEASE NOTES OPENED" };
    } catch {
        return failure("RELEASE NOTES UNAVAILABLE");
    }
}

export async function showRunCommunityUi(): Promise<RunDemoResult> {
    if (!hostAvailable()) return unavailable();
    try {
        const like = await withTimeout(RundotGameAPI.popups.canShowLikeDialog(), READ_TIMEOUT_MS, "like capability");
        if (like.available) {
            await withTimeout(RundotGameAPI.popups.showLikeDialog(), INTERACTIVE_TIMEOUT_MS, "like dialog");
            return { status: "verified", message: "LIKE DIALOG OPENED" };
        }
        const comments = await withTimeout(
            RundotGameAPI.popups.canShowCommentsPanel(),
            READ_TIMEOUT_MS,
            "comments capability",
        );
        if (!comments.available) return unavailable("COMMUNITY UI NOT AVAILABLE HERE");
        await withTimeout(RundotGameAPI.popups.showCommentsPanel(), INTERACTIVE_TIMEOUT_MS, "comments panel");
        return { status: "verified", message: "COMMENTS PANEL OPENED" };
    } catch {
        return failure("COMMUNITY UI FAILED — RECOVERABLE");
    }
}

export async function addRunGameToHome(): Promise<RunDemoResult> {
    if (!hostAvailable()) return unavailable();
    try {
        const supported = await withTimeout(
            RundotGameAPI.system.canAddToHomeScreen(),
            READ_TIMEOUT_MS,
            "add-to-home capability",
        );
        if (!supported) return unavailable("ADD TO HOME NOT AVAILABLE HERE");
        await withTimeout(RundotGameAPI.system.addToHomeScreen(), INTERACTIVE_TIMEOUT_MS, "add to home");
        return { status: "verified", message: "ADD-TO-HOME FLOW COMPLETED" };
    } catch {
        return failure("ADD-TO-HOME FLOW FAILED — RECOVERABLE");
    }
}

export async function inspectRunPlayerServices(): Promise<RunDemoResult> {
    if (!hostAvailable()) return unavailable();
    const probes = await Promise.all([
        probe(
            "shop",
            () => RundotGameAPI.shop.getCatalog(),
            ({ items }) => `${formatNumber(items.length)} SHOP ITEMS`,
        ),
        probe(
            "orders",
            () => RundotGameAPI.shop.getOrderHistory({ limit: 10 }),
            ({ orders }) => `${formatNumber(orders.length)} ORDERS`,
        ),
        probe(
            "entitlements",
            () => RundotGameAPI.entitlements.listEntitlements(),
            (items) => `${formatNumber(items.length)} ENTITLEMENTS`,
        ),
        probe(
            "balance",
            () => RundotGameAPI.iap.getHardCurrencyBalance(),
            (balance) => `${formatNumber(balance)} RUN BITS`,
        ),
        probe(
            "subscriptions",
            () => RundotGameAPI.iap.getSubscriptions(),
            (tiers) =>
                `${formatNumber(Object.values(tiers).reduce((total, items) => total + items.length, 0))} SUBSCRIPTIONS`,
        ),
        probe(
            "stats",
            () => RundotGameAPI.stats.getAllValues(),
            (stats) => `${formatNumber(Object.keys(stats).length)} STATS`,
        ),
        probe(
            "collectibles",
            () => RundotGameAPI.collectibles.listCards(),
            (cards) => `${formatNumber(cards.length)} CARDS`,
        ),
        probe(
            "credits billing",
            () => RundotGameAPI.credits.getBillingContext(),
            () => "CREDITS",
        ),
        probe(
            "clip support",
            () => RundotGameAPI.clips.isSupportedAsync(),
            (support) => `CLIPS ${support.canRecord ? "READY" : "OFF"}`,
        ),
        probe(
            "leaderboard rank",
            () => RundotGameAPI.leaderboard.getMyRank({ mode: "default", period: "alltime" }),
            (rank) => `RANK ${rank.rank === null ? "—" : formatNumber(rank.rank)}`,
        ),
        probe(
            "owned UGC",
            () => RundotGameAPI.ugc.listMine({ limit: 3 }),
            ({ entries }) => `${formatNumber(entries.length)} UGC`,
        ),
    ]);
    return summarizeProbes(probes, "PLAYER DATA");
}

/** RUN permits Clipboard access; writing still requires a direct player tap. */
export async function copyRuntimeText(text: string): Promise<RunDemoResult> {
    if (!navigator.clipboard?.writeText) return unavailable("CLIPBOARD WRITE UNAVAILABLE");
    try {
        await withTimeout(navigator.clipboard.writeText(text), READ_TIMEOUT_MS, "clipboard write");
        return { status: "verified", message: "STATUS COPIED TO CLIPBOARD" };
    } catch {
        return failure("CLIPBOARD WRITE FAILED — CHECK PERMISSION");
    }
}

export async function shareRunScore(score: number): Promise<RunDemoResult> {
    if (!hostAvailable()) return unavailable();
    try {
        await withTimeout(
            RundotGameAPI.social.shareLinkAsync({
                shareParams: { route: "result", score: String(score) },
                metadata: { title: "Pixel Foundry result", description: `Score: ${formatNumber(score)}` },
                slug: "pixel-foundry-result",
            }),
            INTERACTIVE_TIMEOUT_MS,
            "share result",
        );
        return { status: "verified", message: "SHARE LINK CREATED" };
    } catch {
        return failure("SHARE FLOW FAILED — RECOVERABLE");
    }
}

export async function composeRunSocialPost(score: number): Promise<RunDemoResult> {
    if (!hostAvailable()) return unavailable();
    try {
        const result = await withTimeout(
            RundotGameAPI.social.composeSocialPostAsync({
                text: `I scored ${formatNumber(score)} in Pixel Foundry. Can you beat it?`,
                shareParams: { route: "result", score: String(score) },
                title: "Pixel Foundry result",
            }),
            INTERACTIVE_TIMEOUT_MS,
            "social composer",
        );
        return result.completed
            ? { status: "verified", message: `COMPOSER OPENED: ${(result.destination ?? "SHARE").toUpperCase()}` }
            : { status: "cancelled", message: "SOCIAL COMPOSER DISMISSED" };
    } catch {
        return failure("SOCIAL COMPOSER FAILED — RECOVERABLE");
    }
}
