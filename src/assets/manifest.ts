/**
 * Asset manifest — the single place that lists what gets loaded and when.
 * Imported assets live under src/assets/ so Vite fingerprints them and
 * resolves deployment-safe URLs. Use public/ only for files that require an
 * exact, stable name.
 *
 * Two tiers (pattern from a shipped RUN game):
 *   - 'critical'  — awaited during the loading screen. Everything the first
 *                   interactive screen needs: menu art, UI chrome, the sprites
 *                   visible in the first seconds of play.
 *   - 'deferred'  — fire-and-forget background load after boot. Sub-screen
 *                   art, late-game content, anything the player can't see yet.
 *
 * Keep 'critical' small: every asset here delays first interaction.
 */
import type { AssetsManifest, UnresolvedAsset } from "pixi.js";
import portraitBackdropUrl from "./art/pixel-foundry-backdrop-portrait.png";
import wideBackdropUrl from "./art/pixel-foundry-backdrop-wide.png";

/**
 * A narrowing of Pixi's AssetsManifest: Pixi also allows `assets` to be a
 * record, but this template keeps it an array so the tier filters below can
 * check `assets.length`. Still assignable to AssetsManifest (Assets.init).
 */
export interface Manifest extends AssetsManifest {
    bundles: { name: string; assets: UnresolvedAsset[] }[];
}

const startsLandscape = window.matchMedia("(orientation: landscape)").matches;
const activeBackdropUrl = startsLandscape ? wideBackdropUrl : portraitBackdropUrl;
const alternateBackdropUrl = startsLandscape ? portraitBackdropUrl : wideBackdropUrl;

export const MANIFEST: Manifest = {
    bundles: [
        {
            name: "critical",
            // Load only the composition visible at boot. The stylesheet uses
            // the same URL, so the browser cache satisfies both consumers.
            assets: [{ alias: "menu-backdrop-active", src: activeBackdropUrl }],
        },
        {
            name: "deferred",
            assets: [
                // Runtime rotation can reveal the other composition without a
                // reload. Warm it after the first interactive screen is ready.
                { alias: "menu-backdrop-alternate", src: alternateBackdropUrl },
                // ADAPT: sub-screen backgrounds, later levels, and shop art.
            ],
        },
    ],
};

// Empty bundles are skipped so an unused tier never errors.
export const CRITICAL_BUNDLES: string[] = MANIFEST.bundles
    .filter((b) => b.name !== "deferred" && b.assets.length > 0)
    .map((b) => b.name);

export const DEFERRED_BUNDLES: string[] = MANIFEST.bundles
    .filter((b) => b.name === "deferred" && b.assets.length > 0)
    .map((b) => b.name);
