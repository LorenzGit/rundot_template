/**
 * One lifecycle coordinator for the renderer-reference screen.
 *
 * Renderer modules are loaded only when the lab is opened. Hybrid mode uses
 * the same requestAnimationFrame callback for Three and Pixi, avoiding two
 * competing tickers and keeping pause/visibility behavior deterministic.
 */
import type { PixiOverlay } from "./pixi/createPixiOverlay.ts";

export type RendererLabMode = "three-only" | "hybrid";

export interface RendererLab {
    readonly backend: string;
    setPaused(paused: boolean): void;
    destroy(): void;
}

interface RendererLabOptions {
    host: HTMLElement;
    maxPixelRatio: number;
    mode: RendererLabMode;
    paused: boolean;
    reducedMotion: boolean;
    signal: AbortSignal;
}

function throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException("Renderer lab initialization was cancelled", "AbortError");
}

export async function createRendererLab(options: RendererLabOptions): Promise<RendererLab> {
    const threeModule = await import("./three/createThreeReference.ts");
    throwIfAborted(options.signal);
    const three = await threeModule.createThreeReference({
        host: options.host,
        maxPixelRatio: options.maxPixelRatio,
        reducedMotion: options.reducedMotion,
        showThreeUi: options.mode === "three-only",
    });

    let pixi: PixiOverlay | null = null;
    try {
        if (options.mode === "hybrid") {
            const pixiModule = await import("./pixi/createPixiOverlay.ts");
            throwIfAborted(options.signal);
            pixi = await pixiModule.createPixiOverlay({
                host: options.host,
                maxPixelRatio: options.maxPixelRatio,
                reducedMotion: options.reducedMotion,
            });
        }
        throwIfAborted(options.signal);
    } catch (error) {
        pixi?.destroy();
        three.destroy();
        throw error;
    }

    let destroyed = false;
    let hostPaused = options.paused;
    let frameId: number | null = null;
    const startedAt = performance.now();

    const render = (timeMs: number): void => {
        const elapsedSeconds = Math.max(0, timeMs - startedAt) / 1000;
        three.render(elapsedSeconds);
        pixi?.render(elapsedSeconds);
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

        destroy() {
            if (destroyed) return;
            destroyed = true;
            if (frameId !== null) cancelAnimationFrame(frameId);
            frameId = null;
            resizeObserver.disconnect();
            document.removeEventListener("visibilitychange", syncVisibility);
            pixi?.destroy();
            three.destroy();
        },
    };
}
