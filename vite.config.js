import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import {
    rundotGameLibrariesPlugin,
    rundotGamePlaygroundPlugin,
    rundotMultiplayerPlugin,
} from "@series-inc/rundot-game-sdk/vite";
import { rundotSyncplayPlugin } from "@series-inc/rundot-game-sdk/syncplay/tools";

const playgroundEnabled = process.env.RUNDOT_PLAYGROUND === "1";
const multiplayerEnabled = process.env.RUNDOT_MULTIPLAYER === "1";
const syncplayEnabled = process.env.RUNDOT_SYNCPLAY === "1";

const plugins = [rundotGameLibrariesPlugin(), react(), tailwindcss()];

// Playground talks to real RUN services and requires sign-in, so it must never
// ambush ordinary local development. Purchases made there are real/persistent.
if (playgroundEnabled) plugins.push(rundotGamePlaygroundPlugin());

// The room server owns a port and emits a server bundle. Keep it opt-in for
// games that deliberately adopt the multiplayer reference under additional_features/.
if (multiplayerEnabled) {
    plugins.push(
        rundotMultiplayerPlugin({
            // SDK 5.24's server validator resolves the canonical RUN path even
            // when the plugin receives a custom path, so keep one reviewed config.
            configPath: "rundot/realtime.config.json",
            devPort: 9001,
        }),
    );
}

if (syncplayEnabled) {
    plugins.push(
        rundotSyncplayPlugin({
            mode: "strict",
            simulationEntries: ["additional_features/multiplayer/syncplay.ts"],
        }),
    );
}

export default defineConfig({
    // REQUIRED for RUN: deployed builds are served from a subdirectory, so all
    // asset URLs must be relative. Do not change this.
    base: "./",
    plugins,
    server: {
        allowedHosts: true,
        port: 5183,
    },
    build: {
        // Top-level await in the RUN SDK needs a modern target.
        target: "es2022",
        // Renderer libraries stay isolated and cacheable. Three is reached
        // only through the lazy Rendering Lab route in the reference app.
        // The verifier keeps ordinary chunks below 600 kB and allows the
        // optional Three WebGPU distribution up to its explicit 800 kB cap.
        chunkSizeWarningLimit: 800,
        rollupOptions: {
            output: { manualChunks: { pixi: ["pixi.js"], three: ["three/webgpu"] } },
        },
    },
    esbuild: { target: "es2022" },
    optimizeDeps: {
        esbuildOptions: {
            target: "es2022",
        },
    },
});
