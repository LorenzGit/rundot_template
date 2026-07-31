/**
 * In-game HUD: a React overlay above the Pixi canvas.
 *
 * Pattern to keep: the overlay itself is pointer-events-none so taps fall
 * through to the canvas; each interactive control opts back in with
 * pointer-events-auto. `pt-safe-top` (see app.css) pads below the RUN host
 * header.
 */
import { store, useStore } from "../state/store.ts";
import { audioManager } from "../audio/audioManager.ts";
import { saveSystem } from "../systems/save.ts";
import { resumeFromHostPause } from "../systems/hostPause.ts";

export default function Hud() {
    const score = useStore((s) => s.score);
    const paused = useStore((s) => s.paused);
    return (
        <div className="pointer-events-none absolute inset-0 pt-safe-top">
            <div className="game-hud">
                {/* ADAPT: demo counter — replace with real HUD (currencies, wave, timer...) */}
                <div className="hud-score">
                    <span>BOUNCES</span>
                    <strong>{score}</strong>
                </div>
                <button
                    type="button"
                    className="hud-menu pointer-events-auto"
                    onClick={() => {
                        audioManager.play("tap");
                        store.patch({ phase: "menu", menuScreen: "main" });
                        void saveSystem.flush();
                    }}
                >
                    MENU
                </button>
            </div>
            {paused && (
                <button type="button" className="pause-overlay pointer-events-auto" onClick={resumeFromHostPause}>
                    <div>
                        <p className="eyebrow">TAKE A BREATH</p>
                        <strong>PAUSED</strong>
                        <span>TAP TO RESUME</span>
                    </div>
                </button>
            )}
        </div>
    );
}
