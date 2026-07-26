/**
 * Loading screen shown while warmAssets() runs. Rendered by React, revealed
 * when the boot cover lifts, driven by store.loadProgress.
 */
import { useStore } from "../state/store.ts";

export default function LoadingScreen() {
    const progress = useStore((s) => s.loadProgress);
    const pct = Math.round(progress * 100);
    return (
        <main className="loading-screen pt-safe-top pb-safe-bottom">
            <div className="loading-mark" aria-hidden="true">
                <span className="loading-mark-eye loading-mark-eye-left" />
                <span className="loading-mark-eye loading-mark-eye-right" />
                <span className="loading-mark-smile" />
            </div>
            <div className="loading-title">
                <span>PIXEL</span>
                <strong>FOUNDRY</strong>
            </div>
            <div className="loading-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className="loading-fill" style={{ width: `${pct}%` }} />
            </div>
            <p className="loading-copy">BUILDING THE FUN… {pct}%</p>
        </main>
    );
}
