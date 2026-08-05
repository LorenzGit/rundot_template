import React from "react";
import { createRoot } from "react-dom/client";
import App from "./ui/App.tsx";
import ErrorBoundary from "./ui/ErrorBoundary.tsx";
import { store } from "./state/store.ts";
import {
    applyRunSafeArea,
    getRunCapabilities,
    initSdk,
    readAttribution,
    registerLifecycles,
    requestHostExit,
} from "./sdk/runSdk.ts";
import { analytics } from "./systems/analytics/analyticsConfig.ts";
import { resolveReturnLaunch, returnReminders } from "./systems/retention/retentionConfig.ts";
import { warmAssets } from "./assets/preload.ts";
import { saveSystem } from "./systems/save.ts";
import { restoreLocale } from "./systems/localization.ts";
import { audioManager } from "./audio/audioManager.ts";
import { runtimeServices } from "./systems/runtimeServices.ts";
import { abandonDemoLevel } from "./systems/demoAnalytics.ts";
import { resumeFromHostPause, setHostPaused } from "./systems/hostPause.ts";
import { installBrowserQaContract } from "./qa/browserContract.ts";
import "./styles/app.css";

function liftBootCover(): void {
    const cover = document.getElementById("boot-cover");
    if (!cover || cover.classList.contains("hidden")) return;
    cover.classList.add("hidden");
    cover.setAttribute("aria-busy", "false");
    window.setTimeout(() => cover.remove(), 400);
}

/**
 * Drive the HTML boot shell bar (it stays on top for the whole load gate, so
 * it — not the React LoadingScreen underneath — is the progress the player
 * actually sees). Never lift the cover mid-boot: that exposed an empty
 * WebView / native media placeholder between the preloader and React.
 */
function setBootProgress(progress: number): void {
    const p = Math.max(0, Math.min(1, progress));
    const pct = Math.round(p * 100);
    store.patch({ loadProgress: p });

    const cover = document.getElementById("boot-cover");
    const fill = document.getElementById("boot-fill");
    const copy = document.getElementById("boot-copy");
    if (cover) {
        cover.classList.add("is-determinate");
        cover.setAttribute("aria-valuenow", String(pct));
    }
    if (fill) {
        fill.style.width = `${Math.max(5, pct)}%`;
    }
    if (copy) {
        // ADAPT: loading copy
        copy.textContent = pct >= 100 ? "READY" : `BUILDING THE FUN… ${pct}%`;
    }
}

/**
 * Boot contract (same as shipped RUN games / reverie-knights):
 *  1. Loader visible immediately (HTML #boot-cover, then React LoadingScreen).
 *  2. Load only main-menu files under that loader (awaited).
 *  3. Show main menu when those files are ready.
 *  4. Never preload heavy media (videos, late-game art) during the gate —
 *     deferred bundles trickle after menu.
 */
// Fired at module scope, before boot() and before any await: this is the only
// row a player who closes the tab mid-load will ever produce. Everything
// emitted here is buffered until markTransportReady() below.
analytics.installErrorCapture();
analytics.funnelStep("load", 1);

async function boot() {
    // 1. Mount React ASAP — phase is 'loading'. HTML shell already painted.
    const rootElement = document.getElementById("root");
    if (!rootElement) throw new Error("Missing required #root mount element");
    createRoot(rootElement).render(
        <React.StrictMode>
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        </React.StrictMode>,
    );
    // Keep HTML #boot-cover up for the entire load gate — never lift mid-boot
    // (that flashed an empty WebView / native media placeholder).

    // 2. SDK + save under the loader (parallel). Fixed early ticks so the bar
    //    moves during the slowest cold-start stage instead of sitting at zero.
    setBootProgress(0.05);
    await Promise.all([
        initSdk().then(() => {
            // The transport exists now — flush everything boot recorded before
            // this point, then keep going in real time.
            analytics.markTransportReady();
            analytics.funnelStep("load", 2, { host: getRunCapabilities().host });
            applyRunSafeArea();
        }),
        saveSystem.load().then(() => {
            document.documentElement.dataset.reducedMotion = String(store.get().reducedMotion);
            document.documentElement.dataset.quality = store.get().quality;
            restoreLocale();
            audioManager.bind();
            analytics.funnelStep("load", 3);
        }),
    ]);
    setBootProgress(0.15);

    // 3. Main-menu assets only (see src/assets/manifest.ts critical bundle).
    //    Deferred assets background-load after this resolves — not on the gate.
    await warmAssets((p) => setBootProgress(0.15 + p * 0.85));

    // 4. Menu ready — paint one frame under the cover, then fade it.
    setBootProgress(1);
    analytics.funnelStep("load", 4);
    store.patch({ phase: "menu", loadProgress: 1 });
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            liftBootCover();
        });
    });

    if (import.meta.env.DEV) {
        const { applyDevelopmentScreenPreview } = await import("./dev/preview.ts");
        applyDevelopmentScreenPreview();
    }

    // 5. Host lifecycle hooks — register AFTER boot.
    registerLifecycles({
        onPause: () => {
            setHostPaused("host_pause", true);
            void saveSystem.flush();
        },
        onResume: () => {
            setHostPaused("host_pause", false);
        },
        onSleep: () => {
            setHostPaused("host_sleep", true);
            void saveSystem.flush();
            // Re-anchor the 24h nudge to now, so it lands a day after the
            // player actually stopped rather than a day after install.
            void returnReminders.refreshPrimary();
            analytics.sessionPause();
        },
        onAwake: () => {
            setHostPaused("host_sleep", false);
        },
        onQuit: () => {
            void saveSystem.flush();
            void returnReminders.refreshPrimary();
            analytics.sessionEnd();
        },
        onIdentityChanged: (event) => {
            if (event.idChanged) window.location.reload();
            else runtimeServices.resume();
        },
        onBackButton: () => {
            const state = store.get();
            if (state.phase === "playing") {
                abandonDemoLevel("menu_exit");
                resumeFromHostPause();
                store.patch({ phase: "menu", menuScreen: "main" });
                void saveSystem.flush();
            } else if (state.menuScreen === "rendering-lab") {
                store.patch({ menuScreen: "run-features" });
            } else if (state.menuScreen !== "main") {
                store.patch({ menuScreen: "main" });
            } else {
                void requestHostExit();
            }
        },
    });

    // 6. Post-boot fire-and-forget — never block or throw into this function.
    runtimeServices.bootstrap();
    analytics.funnelStep("ftue", 1, { host: getRunCapabilities().host });
    analytics.funnelStep("ftue", 2);
    analytics.sessionStart(store.get().totalPlays === 0, await readAttribution());
    // Deep-link a notification-driven return straight to what the reminder
    // promised. Dropping the player on the main menu after a "your reward is
    // ready" ping makes them hunt for it, and most simply won't.
    const returnReminderId = await resolveReturnLaunch();
    if (returnReminderId === "d1") store.patch({ menuScreen: "daily-rewards" });
    installBrowserQaContract();
}

function preventBrowserChrome(event: Event): void {
    event.preventDefault();
}

document.addEventListener("selectstart", preventBrowserChrome);
document.addEventListener("contextmenu", preventBrowserChrome);
document.addEventListener("dragstart", preventBrowserChrome);

window.addEventListener("unhandledrejection", (event) => {
    console.warn("[runtime] guarded unhandled rejection", event.reason);
    event.preventDefault();
});

function start(): void {
    void boot().catch((error) => {
        console.error("[boot] fatal startup failure", error);
        // A boot failure is the one crash the load funnel cannot infer from a
        // missing step, so name it explicitly. markTransportReady() runs here
        // too — otherwise a failure before SDK init would take the whole
        // buffered load trail down with it.
        analytics.trackError("boot_failure", error);
        analytics.markTransportReady();
        liftBootCover();
        const root = document.getElementById("root");
        if (!root) return;
        const message = document.createElement("main");
        message.className = "fatal-error";
        message.setAttribute("role", "alert");
        const heading = document.createElement("h1");
        heading.textContent = "Unable to start";
        const guidance = document.createElement("p");
        guidance.textContent = "Reload to try again.";
        message.append(heading, guidance);
        root.replaceChildren(message);
    });
}

// Do NOT wait for window "load". Start as soon as the document is interactive.
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
    start();
}
