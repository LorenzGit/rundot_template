import packageJson from "../../package.json";
import { audioManager } from "../audio/audioManager.ts";
import { getRunCapabilities } from "../sdk/runSdk.ts";
import { store } from "../state/store.ts";
import { rendererLifecycleSnapshot } from "../rendering/rendererLifecycle.ts";

interface TemplateGameQa {
    snapshot(): Record<string, unknown>;
    startRun(): void;
    openSettings(): void;
    openRunFeatures(): void;
    openRendererLab(): void;
    returnToMenu(): void;
}

declare global {
    // Development-only semantic browser contract. Never present in production.
    var __gameQa: TemplateGameQa | undefined;
}

export function installBrowserQaContract(): void {
    if (!import.meta.env.DEV || new URLSearchParams(window.location.search).get("qa") !== "1") return;
    document.documentElement.dataset.qaContract = "ready";
    globalThis.__gameQa = {
        snapshot() {
            const state = store.get();
            return {
                version: packageJson.version,
                phase: state.phase,
                menuScreen: state.menuScreen,
                paused: state.paused,
                score: state.score,
                coins: state.coins,
                renderer: document.documentElement.dataset.renderer ?? "pending",
                rendererLifecycle: rendererLifecycleSnapshot(),
                host: getRunCapabilities().host,
                audio: audioManager.debugSnapshot(),
            };
        },
        startRun() {
            store.patch({ phase: "playing", menuScreen: "main" });
        },
        openSettings() {
            store.patch({ phase: "menu", menuScreen: "settings" });
        },
        openRunFeatures() {
            store.patch({ phase: "menu", menuScreen: "run-features" });
        },
        openRendererLab() {
            store.patch({ phase: "menu", menuScreen: "rendering-lab" });
        },
        returnToMenu() {
            store.patch({ phase: "menu", menuScreen: "main" });
        },
    };
}
