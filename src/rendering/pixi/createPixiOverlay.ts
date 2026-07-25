/**
 * Pixi HUD overlay reference for a hybrid Three.js + Pixi game.
 *
 * The coordinator supplies timing and size, so this layer does not create a
 * second ticker. It renders transparent 2D feedback above the Three canvas.
 */
import { Application, Container, Graphics } from "pixi.js";

export interface PixiOverlay {
    readonly backend: "PIXI · WEBGPU" | "PIXI · WEBGL";
    resize(width: number, height: number): void;
    render(elapsedSeconds: number): void;
    destroy(): void;
}

interface PixiOverlayOptions {
    host: HTMLElement;
    maxPixelRatio: number;
    reducedMotion: boolean;
}

type RendererPreference = "webgpu" | "webgl";

async function initializePixi(preference: RendererPreference, maxPixelRatio: number): Promise<Application> {
    const app = new Application();
    try {
        await app.init({
            preference,
            width: 1,
            height: 1,
            resolution: Math.min(window.devicePixelRatio || 1, maxPixelRatio),
            autoDensity: true,
            autoStart: false,
            sharedTicker: false,
            backgroundAlpha: 0,
            antialias: true,
        });
        return app;
    } catch (error) {
        try {
            app.destroy({ removeView: true }, { children: true });
        } catch {
            // Initialization can fail before Pixi has a renderer to destroy.
        }
        throw error;
    }
}

async function createPixi(maxPixelRatio: number): Promise<Application> {
    const requested = new URLSearchParams(window.location.search).get("renderer");
    if (requested === "webgl" || requested === "webgpu") return initializePixi(requested, maxPixelRatio);

    try {
        return await initializePixi("webgpu", maxPixelRatio);
    } catch (webGpuError) {
        console.warn("[renderer-lab] Pixi WebGPU initialization failed; retrying with WebGL", webGpuError);
        return initializePixi("webgl", maxPixelRatio);
    }
}

export async function createPixiOverlay(options: PixiOverlayOptions): Promise<PixiOverlay> {
    const app = await createPixi(options.maxPixelRatio);
    app.canvas.className = "renderer-lab-canvas renderer-lab-overlay";
    app.canvas.dataset.layer = "pixi-ui";
    app.canvas.setAttribute("aria-hidden", "true");
    options.host.appendChild(app.canvas);

    const root = new Container();
    const frame = new Graphics();
    const scanner = new Graphics();
    const reticle = new Graphics();
    root.addChild(frame, scanner, reticle);
    app.stage.addChild(root);

    let width = 1;
    let height = 1;
    let destroyed = false;

    function redraw(): void {
        const margin = Math.max(16, Math.min(width, height) * 0.075);
        const bracket = Math.max(22, Math.min(width, height) * 0.11);
        const lineWidth = Math.max(2, Math.min(width, height) * 0.006);

        frame
            .clear()
            .moveTo(margin, margin + bracket)
            .lineTo(margin, margin)
            .lineTo(margin + bracket, margin)
            .moveTo(width - margin - bracket, margin)
            .lineTo(width - margin, margin)
            .lineTo(width - margin, margin + bracket)
            .moveTo(margin, height - margin - bracket)
            .lineTo(margin, height - margin)
            .lineTo(margin + bracket, height - margin)
            .moveTo(width - margin - bracket, height - margin)
            .lineTo(width - margin, height - margin)
            .lineTo(width - margin, height - margin - bracket)
            .stroke({ color: 0xf4c95d, width: lineWidth, alpha: 0.88 });

        scanner
            .clear()
            .rect(0, 0, Math.max(2, lineWidth), height - margin * 2)
            .fill({ color: 0x5aa7c7, alpha: 0.74 });
        scanner.y = margin;

        const radius = Math.max(14, Math.min(width, height) * 0.055);
        reticle
            .clear()
            .circle(0, 0, radius)
            .stroke({ color: 0xf4c95d, width: lineWidth, alpha: 0.94 })
            .moveTo(-radius * 1.55, 0)
            .lineTo(-radius * 0.72, 0)
            .moveTo(radius * 0.72, 0)
            .lineTo(radius * 1.55, 0)
            .moveTo(0, -radius * 1.55)
            .lineTo(0, -radius * 0.72)
            .moveTo(0, radius * 0.72)
            .lineTo(0, radius * 1.55)
            .stroke({ color: 0xf4c95d, width: lineWidth, alpha: 0.94 });
        reticle.position.set(width / 2, height / 2);
    }

    return {
        backend: app.renderer.constructor.name.toLowerCase().includes("webgpu") ? "PIXI · WEBGPU" : "PIXI · WEBGL",

        resize(nextWidth, nextHeight) {
            if (destroyed) return;
            width = Math.max(1, nextWidth);
            height = Math.max(1, nextHeight);
            app.renderer.resize(width, height, Math.min(window.devicePixelRatio || 1, options.maxPixelRatio));
            redraw();
        },

        render(elapsedSeconds) {
            if (destroyed) return;
            const time = options.reducedMotion ? 0.5 : elapsedSeconds;
            const travel = Math.max(1, width - Math.max(32, Math.min(width, height) * 0.15));
            scanner.x = (width - travel) / 2 + ((Math.sin(time * 0.9) + 1) / 2) * travel;
            reticle.alpha = 0.78 + Math.sin(time * 2.1) * 0.16;
            reticle.rotation = Math.sin(time * 0.45) * 0.09;
            app.render();
        },

        destroy() {
            if (destroyed) return;
            destroyed = true;
            app.destroy({ removeView: true }, { children: true });
        },
    };
}
