/**
 * React ↔ Pixi boundary. React owns WHEN the game exists (mount/unmount with
 * the 'playing' phase); Pixi owns everything inside the canvas. No React
 * state flows in per-frame — game → UI communication goes through the store.
 *
 * StrictMode-safe: the realm-wide renderer lifecycle queue serializes the
 * mount/cleanup/mount sequence, including initialization itself.
 */
import { useEffect, useRef } from "react";
import type { Application } from "pixi.js";
import { createPixiApp } from "./pixiApp.ts";
import { createStage, type Stage } from "./stage.ts";
import { createDemoScene, type Scene } from "./demoScene.ts";
import { store, useStore } from "../state/store.ts";
import { abandonDemoLevel, demoLevelAnalytics } from "../systems/demoAnalytics.ts";
import {
    acquireRendererRuntime,
    type RendererLease,
    type RendererLifecycleScope,
} from "../rendering/rendererLifecycle.ts";

interface GameRenderer {
    app: Application;
}

async function initializeGameRenderer(scope: RendererLifecycleScope, host: HTMLElement): Promise<GameRenderer> {
    const app = await createPixiApp(scope, host);
    scope.throwIfCancelled();

    // Design-resolution stage: scenes position in design units, not pixels.
    const stage: Stage = createStage(app);
    scope.manage(() => stage.destroy());

    // ADAPT: replace the demo scene with the real game scene.
    const scene: Scene = createDemoScene(app, stage);
    scope.manage(() => scene.destroy());

    // Respect a pause that landed while the canvas was initializing.
    if (store.get().paused || document.hidden) app.ticker.stop();
    return { app };
}

export default function GameCanvas() {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const appRef = useRef<Application | null>(null);
    const paused = useStore((s) => s.paused);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const abortController = new AbortController();
        let lease: RendererLease<GameRenderer> | null = null;

        void acquireRendererRuntime("pixi-game", abortController.signal, (scope) => initializeGameRenderer(scope, host))
            .then((nextLease) => {
                lease = nextLease;
                appRef.current = nextLease.value.app;
            })
            .catch((error: unknown) => {
                if (abortController.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
                    return;
                }
                console.error("[renderer] Pixi initialization failed", error);
                abandonDemoLevel("renderer_error");
                store.patch({
                    phase: "menu",
                    menuScreen: "main",
                    toast: "RENDERER UNAVAILABLE — TRY A DIFFERENT DEVICE",
                });
            });

        return () => {
            abortController.abort();
            appRef.current = null;
            void lease?.release();
        };
    }, []);

    // Host lifecycle pause/resume → freeze/unfreeze the whole ticker.
    useEffect(() => {
        const app = appRef.current;
        if (!app) return;
        if (paused || document.hidden) app.ticker.stop();
        else app.ticker.start();
    }, [paused]);

    // Browser visibility is a second lifecycle source outside the RUN host.
    // Keep it independent from `paused` so a visibility event cannot clear a
    // host-owned pause overlay.
    useEffect(() => {
        const syncVisibility = () => {
            const app = appRef.current;
            demoLevelAnalytics.setPaused("document_hidden", document.hidden);
            if (!app) return;
            if (document.hidden || store.get().paused) app.ticker.stop();
            else app.ticker.start();
        };
        syncVisibility();
        document.addEventListener("visibilitychange", syncVisibility);
        return () => document.removeEventListener("visibilitychange", syncVisibility);
    }, []);

    return <div ref={hostRef} className="absolute inset-0" />;
}
