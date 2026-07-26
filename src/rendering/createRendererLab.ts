/**
 * One lifecycle coordinator for the renderer-reference screen.
 *
 * Renderer modules are loaded only when the lab is opened. Hybrid mode uses
 * the same requestAnimationFrame callback for Three and Pixi, avoiding two
 * competing tickers and keeping pause/visibility behavior deterministic.
 */
import type { PixiOverlay } from "./pixi/createPixiOverlay.ts";
import { acquireRendererRuntime, type RendererLease, type RendererLifecycleScope } from "./rendererLifecycle.ts";

export type RendererLabMode = "three-only" | "hybrid";

export interface RendererLab {
    readonly backend: string;
    setPaused(paused: boolean): void;
}

interface RendererLabOptions {
    host: HTMLElement;
    maxPixelRatio: number;
    mode: RendererLabMode;
    paused: boolean;
    reducedMotion: boolean;
    signal: AbortSignal;
}

async function initializeRendererLab(scope: RendererLifecycleScope, options: RendererLabOptions): Promise<RendererLab> {
    const threeModule = await import("./three/createThreeReference.ts");
    scope.throwIfCancelled();
    const three = await threeModule.createThreeReference(scope, {
        host: options.host,
        maxPixelRatio: options.maxPixelRatio,
        reducedMotion: options.reducedMotion,
        showThreeUi: options.mode === "three-only",
    });

    let pixi: PixiOverlay | null = null;
    if (options.mode === "hybrid") {
        const pixiModule = await import("./pixi/createPixiOverlay.ts");
        scope.throwIfCancelled();
        pixi = await pixiModule.createPixiOverlay(scope, {
            host: options.host,
            maxPixelRatio: options.maxPixelRatio,
            reducedMotion: options.reducedMotion,
        });
    }
    scope.throwIfCancelled();

    let destroyed = false;
    let hostPaused = options.paused;
    let frameId: number | null = null;
    const startedAt = performance.now();

    const render = (timeMs: number): void => {
        try {
            const elapsedSeconds = Math.max(0, timeMs - startedAt) / 1000;
            three.render(elapsedSeconds);
            pixi?.render(elapsedSeconds);
        } catch (error) {
            hostPaused = true;
            if (frameId !== null) cancelAnimationFrame(frameId);
            frameId = null;
            scope.reportFailure(error);
        }
    };

    const schedule = (): void => {
        if (destroyed || hostPaused || document.hidden || options.reducedMotion || frameId !== null) return;
        frameId = requestAnimationFrame(tick);
    };

    const tick = (timeMs: number): void => {
        frameId = null;
        render(timeMs);
        schedule();
    };

    const resize = (): void => {
        if (destroyed) return;
        const bounds = options.host.getBoundingClientRect();
        const width = Math.max(1, Math.round(bounds.width));
        const height = Math.max(1, Math.round(bounds.height));
        three.resize(width, height);
        pixi?.resize(width, height);
        render(performance.now());
    };

    const syncVisibility = (): void => {
        if (document.hidden && frameId !== null) {
            cancelAnimationFrame(frameId);
            frameId = null;
        }
        schedule();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(options.host);
    document.addEventListener("visibilitychange", syncVisibility);
    scope.manage(() => {
        if (destroyed) return;
        destroyed = true;
        if (frameId !== null) cancelAnimationFrame(frameId);
        frameId = null;
        resizeObserver.disconnect();
        document.removeEventListener("visibilitychange", syncVisibility);
    });
    resize();
    schedule();

    return {
        backend: pixi ? `${three.backend} + ${pixi.backend}` : three.backend,

        setPaused(paused) {
            hostPaused = paused;
            if (paused && frameId !== null) {
                cancelAnimationFrame(frameId);
                frameId = null;
            }
            if (!paused) {
                render(performance.now());
                schedule();
            }
        },
    };
}

export function createRendererLab(options: RendererLabOptions): Promise<RendererLease<RendererLab>> {
    return acquireRendererRuntime("renderer-lab", options.signal, (scope) => initializeRendererLab(scope, options));
}
