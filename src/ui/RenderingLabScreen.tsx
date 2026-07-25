import { useEffect, useRef, useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { createRendererLab, type RendererLab, type RendererLabMode } from "../rendering/createRendererLab.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { store, useStore } from "../state/store.ts";
import MenuScreenLayout from "./MenuScreenLayout.tsx";

const MODE_COPY: Record<RendererLabMode, { title: string; description: string; label: string }> = {
    "three-only": {
        title: "THREE-ONLY WORLD + UI",
        description:
            "Three renders both the perspective world and the geometry HUD. A derived 3D game can replace the HUD with SDF text, textured panels, or a complete Three UI system without keeping Pixi.",
        label: "Three-only scene with a Three-rendered geometry interface",
    },
    hybrid: {
        title: "THREE WORLD + PIXI UI",
        description:
            "Three owns the world canvas while a transparent Pixi canvas owns the yellow HUD. One coordinator resizes, pauses, renders, and destroys both layers.",
        label: "Three scene with a transparent Pixi interface layered above it",
    },
};

export default function RenderingLabScreen() {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const labRef = useRef<RendererLab | null>(null);
    const paused = useStore((state) => state.paused);
    const quality = useStore((state) => state.quality);
    const reducedMotion = useStore((state) => state.reducedMotion);
    const [mode, setMode] = useState<RendererLabMode>("three-only");
    const [status, setStatus] = useState("LOADING RENDERERS…");
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const abortController = new AbortController();
        let disposed = false;
        setFailed(false);
        setStatus("LOADING RENDERERS…");

        void createRendererLab({
            host,
            maxPixelRatio: quality === "high" ? 2 : 1,
            mode,
            paused: store.get().paused,
            reducedMotion,
            signal: abortController.signal,
        })
            .then((lab) => {
                if (disposed) {
                    lab.destroy();
                    return;
                }
                labRef.current = lab;
                lab.setPaused(store.get().paused);
                setStatus(lab.backend);
            })
            .catch((error: unknown) => {
                if (disposed || (error instanceof DOMException && error.name === "AbortError")) return;
                console.error("[renderer-lab] initialization failed", error);
                setFailed(true);
                setStatus("RENDERER UNAVAILABLE");
            });

        return () => {
            disposed = true;
            abortController.abort();
            labRef.current?.destroy();
            labRef.current = null;
        };
    }, [mode, quality, reducedMotion]);

    useEffect(() => {
        labRef.current?.setPaused(paused);
    }, [paused]);

    const selectMode = async (nextMode: RendererLabMode): Promise<void> => {
        if (nextMode === mode) return;
        await audioManager.unlock();
        audioManager.play("tap");
        void runtimeServices.haptic("light");
        setMode(nextMode);
    };

    return (
        <MenuScreenLayout title="RENDERING LAB" kicker="PICK / COMPOSE / REMOVE" backScreen="run-features">
            <p className="screen-copy">
                These are small architecture proofs, not a game scaffold to copy wholesale. Keep one renderer, the
                other, or the composition boundary—then delete everything the actual game does not need.
            </p>

            <fieldset className="renderer-mode-switch" aria-label="Renderer architecture">
                <button
                    type="button"
                    aria-pressed={mode === "three-only"}
                    onClick={() => void selectMode("three-only")}
                >
                    THREE ONLY
                </button>
                <button type="button" aria-pressed={mode === "hybrid"} onClick={() => void selectMode("hybrid")}>
                    THREE + PIXI
                </button>
            </fieldset>

            <section ref={hostRef} className="renderer-lab-viewport" role="img" aria-label={MODE_COPY[mode].label}>
                <span className={`renderer-lab-status${failed ? " renderer-lab-status-error" : ""}`}>{status}</span>
            </section>

            <article className="renderer-lab-explanation">
                <p className="eyebrow">ACTIVE COMPOSITION</p>
                <h3>{MODE_COPY[mode].title}</h3>
                <p>{MODE_COPY[mode].description}</p>
                <ul>
                    <li>WebGPU-first with a visible WebGL fallback result.</li>
                    <li>One resize observer and one animation loop across active layers.</li>
                    <li>Host pause, tab visibility, quality, reduced motion, and explicit GPU cleanup.</li>
                </ul>
            </article>

            <p className="safety-note">
                Read docs/rendering-architecture.md before choosing a renderer for a derived game. The game concept
                decides the renderer; this reference does not decide the game.
            </p>
        </MenuScreenLayout>
    );
}
