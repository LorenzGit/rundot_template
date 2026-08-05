/**
 * Screen router. One phase visible at a time; the 'playing' phase stacks the
 * React HUD above the Pixi canvas.
 *
 * #app-frame (styled in styles/app.css) is the playable frame: portrait-first
 * with a dedicated landscape layout, centered over a full-bleed backdrop.
 * Everything interactive — canvas and DOM UI — lives inside the frame, so
 * safe areas and input never leak into decorative side art.
 */
import { store, useStore } from "../state/store.ts";
import { lazy, Suspense, useEffect } from "react";
import LoadingScreen from "./LoadingScreen.tsx";
import MainMenu from "./MainMenu.tsx";
import Hud from "./Hud.tsx";
import GameCanvas from "../game/GameCanvas.tsx";
import DailyRewardsScreen from "./DailyRewardsScreen.tsx";
import DailyQuestsScreen from "./DailyQuestsScreen.tsx";
import ShopScreen from "./ShopScreen.tsx";
import StatsScreen from "./StatsScreen.tsx";
import SettingsScreen from "./SettingsScreen.tsx";
import { applyRunSafeArea } from "../sdk/runSdk.ts";
import { audioManager } from "../audio/audioManager.ts";
import { useButtonFeedback } from "./useButtonFeedback.ts";

const RunFeaturesScreen = lazy(() => import("./RunFeaturesScreen.tsx"));
const RenderingLabScreen = lazy(() => import("./RenderingLabScreen.tsx"));
const DevelopmentTools = import.meta.env.DEV ? lazy(() => import("../dev/DevelopmentTools.tsx")) : null;
const TOAST_AUTO_HIDE_MS = 4_000;

function useOrientationSafeArea(): void {
    useEffect(() => {
        const refreshSafeArea = () => {
            applyRunSafeArea();
        };
        // Published insets are #app-frame-relative (see applyRunSafeArea), and
        // the frame rect moves on ANY resize — not just rotation. Coalesce
        // resize bursts to one refresh per frame.
        let pending = 0;
        const refreshOnResize = () => {
            window.cancelAnimationFrame(pending);
            pending = window.requestAnimationFrame(refreshSafeArea);
        };
        window.addEventListener("orientationchange", refreshSafeArea);
        window.addEventListener("resize", refreshOnResize, { passive: true });
        return () => {
            window.removeEventListener("orientationchange", refreshSafeArea);
            window.removeEventListener("resize", refreshOnResize);
            window.cancelAnimationFrame(pending);
        };
    }, []);
}

/**
 * Web Audio starts suspended until a real user gesture resumes it. Unlock on
 * the FIRST interaction anywhere — never only from specific screens: unlock
 * coverage that depends on which menus a game keeps breaks silently when a
 * fork replaces those screens (a shipped game went fully silent exactly
 * this way).
 */
function useAudioUnlock(): void {
    useEffect(() => {
        const unlock = () => {
            void audioManager.unlock();
        };
        const options = { once: true, capture: true } as const;
        window.addEventListener("pointerdown", unlock, options);
        window.addEventListener("keydown", unlock, options);
        return () => {
            window.removeEventListener("pointerdown", unlock, options);
            window.removeEventListener("keydown", unlock, options);
        };
    }, []);
}

function MenuRoute() {
    const screen = useStore((state) => state.menuScreen);
    if (screen === "daily-rewards") return <DailyRewardsScreen />;
    if (screen === "daily-quests") return <DailyQuestsScreen />;
    if (screen === "shop") return <ShopScreen />;
    if (screen === "stats") return <StatsScreen />;
    if (screen === "run-features")
        return (
            <Suspense
                fallback={
                    <main className="route-loading" aria-busy="true">
                        LOADING RUN FEATURES…
                    </main>
                }
            >
                <RunFeaturesScreen />
            </Suspense>
        );
    if (screen === "rendering-lab")
        return (
            <Suspense
                fallback={
                    <main className="route-loading" aria-busy="true">
                        LOADING RENDERING LAB…
                    </main>
                }
            >
                <RenderingLabScreen />
            </Suspense>
        );
    if (screen === "settings") return <SettingsScreen />;
    return <MainMenu />;
}

export default function App() {
    useOrientationSafeArea();
    useAudioUnlock();
    useButtonFeedback();
    const phase = useStore((s) => s.phase);

    // Drop the HTML boot cover once we leave loading (ViewDeck can throttle rAF).
    useEffect(() => {
        if (phase === "loading") return;
        const cover = document.getElementById("boot-cover");
        if (!cover) return;
        cover.classList.add("hidden");
        const t = window.setTimeout(() => cover.remove(), 400);
        return () => window.clearTimeout(t);
    }, [phase]);

    return (
        <div id="app-frame" className="bg-surface text-white">
            {phase === "loading" && <LoadingScreen />}
            {phase === "menu" && <MenuRoute />}
            {phase === "playing" && (
                <div className="absolute inset-0">
                    <GameCanvas />
                    <Hud />
                </div>
            )}
            <Toast />
            <DevelopmentToolsSlot />
        </div>
    );
}

function DevelopmentToolsSlot() {
    if (!DevelopmentTools || new URLSearchParams(window.location.search).get("debug") !== "1") return null;
    return (
        <Suspense fallback={null}>
            <DevelopmentTools />
        </Suspense>
    );
}

function Toast() {
    const toast = useStore((state) => state.toast);

    useEffect(() => {
        if (!toast) return;
        const timeoutId = window.setTimeout(() => {
            // Do not let an older toast's timer dismiss a newer message.
            if (store.get().toast === toast) store.patch({ toast: null });
        }, TOAST_AUTO_HIDE_MS);
        return () => window.clearTimeout(timeoutId);
    }, [toast]);

    if (!toast) return null;
    return (
        <button type="button" className="toast" aria-live="polite" onClick={() => store.patch({ toast: null })}>
            {toast}
        </button>
    );
}
