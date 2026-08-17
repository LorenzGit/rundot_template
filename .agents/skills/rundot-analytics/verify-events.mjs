/**
 * Runtime proof that analytics events actually fire, with the names we expect.
 *
 * Typecheck and build only prove the code compiles. In local mock mode the SDK's
 * `recordCustomEvent` is a deliberate no-op (MockAnalyticsApi just awaits a
 * delay), so there is no network call or postMessage to observe. The only
 * reliable hook is to rewrite the SDK module *as it is served*: Playwright
 * intercepts the JS response and replaces the mock method bodies with versions
 * that also push to `window.__rundotEvents`. Nothing on disk is modified.
 *
 *   node .agents/skills/rundot-analytics/verify-events.mjs . 5330 [--seconds=25]
 *
 * Playwright is not a dependency of most games; point PLAYWRIGHT_MODULE at any
 * sibling install if the default path does not exist.
 */
import { spawn } from "node:child_process";
import path from "node:path";

const PLAYWRIGHT =
    process.env.PLAYWRIGHT_MODULE ?? new URL("../../../node_modules/playwright/index.mjs", import.meta.url).href;
const { chromium } = await import(PLAYWRIGHT);

const gameDir = process.argv[2];
const port = Number(process.argv[3] ?? 5300);
const seconds = Number((process.argv.find((a) => a.startsWith("--seconds")) ?? "--seconds=22").split("=")[1] ?? 22);
if (!gameDir) {
    console.error("usage: verify-events.mjs <gameDir> <port> [--seconds=25]");
    process.exit(1);
}

/**
 * Rewrites the mock no-ops into recording versions.
 *
 * Regex, not exact strings: some games let Vite pre-bundle the SDK into
 * optimized deps, which reformats the whitespace. An exact-match patch silently
 * matched nothing there and reported zero events, which reads identically to
 * "the game emits nothing".
 */
function instrument(body) {
    let hits = 0;
    body = body.replace(
        /async\s+recordCustomEvent\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*await\s+createMockDelay/g,
        (_m, name, payload) => {
            hits += 1;
            return `async recordCustomEvent(${name}, ${payload}) { (globalThis.__rundotEvents ||= []).push({ kind: "event", name: ${name}, payload: ${payload} }); await createMockDelay`;
        },
    );
    body = body.replace(
        /async\s+trackFunnelStep\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*,\s*([A-Za-z_$][\w$]*)\s*\)\s*\{\s*await\s+createMockDelay/g,
        (_m, step, name, funnel) => {
            hits += 1;
            return `async trackFunnelStep(${step}, ${name}, ${funnel}, o__) { (globalThis.__rundotEvents ||= []).push({ kind: "funnel", name: ${name}, funnel: ${funnel}, step: ${step} }); await createMockDelay`;
        },
    );
    return { body, hits };
}

const server = spawn("npm", ["run", "dev", "--prefix", gameDir, "--", "--port", String(port), "--strictPort"], {
    stdio: "ignore",
    detached: true,
});
const stop = () => {
    try {
        process.kill(-server.pid);
    } catch {}
};
process.on("exit", stop);

// Wait for the dev server to answer.
const base = `http://localhost:${port}`;
let up = false;
for (let i = 0; i < 60 && !up; i += 1) {
    try {
        const r = await fetch(base);
        up = r.ok;
    } catch {
        await new Promise((r) => setTimeout(r, 500));
    }
}
if (!up) {
    console.error(JSON.stringify({ game: path.basename(gameDir), error: "dev server never came up" }));
    stop();
    process.exit(1);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 420, height: 860 }, hasTouch: true, isMobile: true });

let patched = 0;
await page.route("**/*.js*", async (route) => {
    const res = await route.fetch();
    let body = await res.text();
    const out = instrument(body);
    body = out.body;
    if (out.hits) patched += out.hits;
    await route.fulfill({ response: res, body });
});

const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));

// WebGPU kills headless chromium; force the WebGL path.
await page.goto(`${base}/?renderer=webgl&qa=1`, { waitUntil: "domcontentloaded" }).catch(() => {});
await page.waitForTimeout(6000);

/** Poke the game: tap the most prominent control, then the canvas centre. */
async function poke(round) {
    const labels = ["play", "start", "begin", "tap", "continue", "next", "ok", "deploy", "go"];
    for (const l of labels) {
        const btn = page.locator(`button:has-text("${l}"), [role=button]:has-text("${l}")`).first();
        if ((await btn.count()) && (await btn.isVisible().catch(() => false))) {
            await btn.click({ force: true, timeout: 1500 }).catch(() => {});
            await page.waitForTimeout(700);
            return;
        }
    }
    const box = page.viewportSize();
    const x = box.width / 2;
    const y = box.height * (round % 2 ? 0.55 : 0.7);
    await page.mouse.click(x, y).catch(() => {});
    await page.touchscreen.tap(x, y).catch(() => {});
}

const deadline = Date.now() + seconds * 1000;
let round = 0;
while (Date.now() < deadline) {
    await poke(round++);
    await page.waitForTimeout(900);
}

const events = await page.evaluate(() => globalThis.__rundotEvents ?? []);
await browser.close();
stop();

const byName = {};
for (const e of events) {
    const key = e.kind === "funnel" ? `funnel:${e.funnel}:${e.name}` : e.name;
    byName[key] = (byName[key] ?? 0) + 1;
}
console.log(
    JSON.stringify({
        game: path.basename(gameDir),
        sdkChunksPatched: patched,
        totalEvents: events.length,
        events: byName,
        pageErrors: errors.slice(0, 3),
    }),
);
