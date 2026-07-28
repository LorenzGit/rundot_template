import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

interface QaSnapshot {
    phase: "loading" | "menu" | "playing";
    menuScreen: string;
    coins: number;
    rendererLifecycle: {
        activeLabel: string | null;
        activeRuntimes: number;
        initializing: boolean;
        maximumActiveRuntimes: number;
        maximumConcurrentInitializations: number;
        failureCount: number;
    };
}

const viewports = [
    { name: "short portrait phone", width: 320, height: 568 },
    { name: "tall portrait phone", width: 390, height: 844 },
    { name: "short landscape phone", width: 568, height: 320 },
    { name: "wide landscape phone", width: 844, height: 390 },
    { name: "tablet", width: 1024, height: 768 },
    { name: "desktop embed", width: 1440, height: 900 },
] as const;

async function openReady(page: Page, query = "qa=1"): Promise<void> {
    await page.goto(`/?${query}`);
    await expect(page.locator("html")).toHaveAttribute("data-qa-contract", "ready");
    await expect(page.locator("#app-frame")).toBeVisible();
}

async function readQaSnapshot(page: Page): Promise<QaSnapshot> {
    return page.evaluate(() => {
        const qa = (
            globalThis as typeof globalThis & {
                __gameQa?: { snapshot(): QaSnapshot };
            }
        ).__gameQa;
        if (!qa) throw new Error("Development QA contract is unavailable");
        return qa.snapshot();
    });
}

async function assertVisibleUiFits(page: Page): Promise<void> {
    const result = await page.locator("#app-frame").evaluate((frame) => {
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        const frameRect = frame.getBoundingClientRect();
        const interactive = Array.from(frame.querySelectorAll<HTMLElement>("button, input, select, [role='button']"))
            .filter((element) => {
                const style = getComputedStyle(element);
                const rect = element.getBoundingClientRect();
                return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
            })
            .map((element) => {
                const rect = element.getBoundingClientRect();
                return {
                    label: element.getAttribute("aria-label") || element.textContent?.trim() || element.tagName,
                    left: rect.left,
                    right: rect.right,
                    top: rect.top,
                    bottom: rect.bottom,
                };
            });
        const clipped = interactive.filter(
            (item) =>
                item.left < -1 || item.top < -1 || item.right > viewport.width + 1 || item.bottom > viewport.height + 1,
        );
        const textSizes = Array.from(frame.querySelectorAll<HTMLElement>("*"))
            .filter((element) => {
                const rect = element.getBoundingClientRect();
                const style = getComputedStyle(element);
                const hasOwnText = Array.from(element.childNodes).some(
                    (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
                );
                return hasOwnText && rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
            })
            .map((element) => Number.parseFloat(getComputedStyle(element).fontSize))
            .filter(Number.isFinite);
        return {
            frameFits:
                frameRect.left >= -1 &&
                frameRect.top >= -1 &&
                frameRect.right <= viewport.width + 1 &&
                frameRect.bottom <= viewport.height + 1,
            clipped,
            smallestText: Math.min(...textSizes),
        };
    });
    expect(result.frameFits).toBe(true);
    expect(result.clipped).toEqual([]);
    expect(result.smallestText).toBeGreaterThanOrEqual(10);
}

for (const viewport of viewports) {
    test(`main menu fits the ${viewport.name}`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await openReady(page);
        await expect(page.getByRole("button", { name: /play demo/i })).toBeVisible();
        await assertVisibleUiFits(page);
    });
}

test("direct screen preview is reachable and its content scrolls to the end", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 600 });
    await openReady(page, "qa=1&screen=run-features");
    await expect(page.getByRole("heading", { name: "RUN FEATURES" })).toBeVisible();

    const scrollRegion = page.getByTestId("screen-scroll-region");
    const dimensions = await scrollRegion.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
    }));
    expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
    await scrollRegion.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(page.getByTestId("screen-end")).toBeInViewport();

    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
    await scrollRegion.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(page.getByTestId("screen-end")).toBeInViewport();
});

test("orientation changes refresh safe areas without losing game state", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, "qa=1&screen=game");
    const before = await readQaSnapshot(page);
    expect(before.phase).toBe("playing");
    const refreshBefore = Number((await page.locator("html").getAttribute("data-safe-area-refresh-count")) ?? 0);

    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
    await expect
        .poll(async () => Number((await page.locator("html").getAttribute("data-safe-area-refresh-count")) ?? 0))
        .toBeGreaterThan(refreshBefore);
    const landscape = await readQaSnapshot(page);
    expect(landscape.phase).toBe("playing");
    expect(landscape.coins).toBe(before.coins);

    const refreshLandscape = Number(
        (await page.locator("html").getAttribute("data-safe-area-refresh-count")) ?? refreshBefore,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.dispatchEvent(new Event("orientationchange")));
    await expect
        .poll(async () => Number((await page.locator("html").getAttribute("data-safe-area-refresh-count")) ?? 0))
        .toBeGreaterThan(refreshLandscape);
    expect((await readQaSnapshot(page)).phase).toBe("playing");
});

test("landscape consumes ViewDeck side insets without a phantom bottom inset", async ({ page }) => {
    await page.setViewportSize({ width: 960, height: 444 });
    const safeArea = { top: 0, right: 34, bottom: 0, left: 62 };
    await page.addInitScript((insets) => {
        const apply = () => {
            const root = document.documentElement;
            if (!root) return;
            root.dataset.viewdeckSafeArea = JSON.stringify(insets);
            for (const edge of ["top", "right", "bottom", "left"] as const) {
                root.style.setProperty(`--viewdeck-safe-area-inset-${edge}`, `${insets[edge]}px`);
            }
        };
        if (document.documentElement) apply();
        else document.addEventListener("DOMContentLoaded", apply, { once: true });
    }, safeArea);
    await openReady(page, "qa=1&screen=daily-rewards");
    await expect(page.getByRole("heading", { name: "DAILY REWARDS" })).toBeVisible();

    const layout = await page.evaluate(() => {
        const rootStyle = getComputedStyle(document.documentElement);
        const screen = document.querySelector<HTMLElement>(".subscreen");
        const back = document.querySelector<HTMLElement>(".back-button");
        const scrollRegion = document.querySelector<HTMLElement>("[data-testid='screen-scroll-region']");
        if (!screen || !back || !scrollRegion) throw new Error("Daily rewards layout is unavailable");
        const screenStyle = getComputedStyle(screen);
        return {
            safeArea: {
                top: rootStyle.getPropertyValue("--safe-top").trim(),
                right: rootStyle.getPropertyValue("--safe-right").trim(),
                bottom: rootStyle.getPropertyValue("--safe-bottom").trim(),
                left: rootStyle.getPropertyValue("--safe-left").trim(),
            },
            screenPadding: {
                right: Number.parseFloat(screenStyle.paddingRight),
                bottom: Number.parseFloat(screenStyle.paddingBottom),
                left: Number.parseFloat(screenStyle.paddingLeft),
            },
            backLeft: back.getBoundingClientRect().left,
            scrollable: scrollRegion.scrollHeight > scrollRegion.clientHeight,
        };
    });

    expect(layout.safeArea).toEqual({ top: "0px", right: "34px", bottom: "0px", left: "62px" });
    expect(layout.screenPadding.left).toBeGreaterThanOrEqual(safeArea.left);
    expect(layout.screenPadding.right).toBeGreaterThanOrEqual(safeArea.right);
    expect(layout.screenPadding.bottom).toBe(8);
    expect(layout.backLeft).toBeGreaterThanOrEqual(safeArea.left);
    expect(layout.scrollable).toBe(true);

    const scrollRegion = page.getByTestId("screen-scroll-region");
    await scrollRegion.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(page.getByTestId("screen-end")).toBeInViewport();
    const claimRect = await page.locator(".claim-action").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
    });
    expect(claimRect.left).toBeGreaterThanOrEqual(safeArea.left);
    expect(claimRect.right).toBeLessThanOrEqual(960 - safeArea.right);
});

test("renderer lifecycle serializes StrictMode, route changes, and hybrid mode", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, "qa=1&screen=game&renderer=webgl");
    await expect(page.locator("canvas[data-renderer='webgl']")).toHaveCount(1);
    await expect.poll(async () => (await readQaSnapshot(page)).rendererLifecycle.activeLabel).toBe("pixi-game");

    for (let cycle = 0; cycle < 2; cycle += 1) {
        await page.evaluate(() => globalThis.__gameQa?.returnToMenu());
        await expect(page.locator("canvas")).toHaveCount(0);
        await expect.poll(async () => (await readQaSnapshot(page)).rendererLifecycle.activeRuntimes).toBe(0);

        await page.evaluate(() => globalThis.__gameQa?.openRendererLab());
        await expect(page.getByRole("heading", { name: "RENDERING LAB" })).toBeVisible();
        await expect(page.locator(".renderer-lab-status")).toContainText("THREE · WEBGL 2");
        await expect.poll(async () => (await readQaSnapshot(page)).rendererLifecycle.activeLabel).toBe("renderer-lab");

        await page.getByRole("button", { name: "THREE + PIXI" }).click();
        await expect(page.locator(".renderer-lab-status")).toContainText("THREE · WEBGL 2 + PIXI · WEBGL");
        await expect(page.locator(".renderer-lab-canvas")).toHaveCount(2);

        await page.evaluate(() => globalThis.__gameQa?.returnToMenu());
        await expect(page.locator("canvas")).toHaveCount(0);
    }

    const lifecycle = (await readQaSnapshot(page)).rendererLifecycle;
    expect(lifecycle.maximumActiveRuntimes).toBe(1);
    expect(lifecycle.maximumConcurrentInitializations).toBe(1);
    expect(lifecycle.failureCount).toBe(0);
});

test("development diagnostics tune only the current session", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openReady(page, "qa=1&screen=settings&debug=1");
    await expect(page.getByTestId("development-tools")).toBeVisible();
    await expect(page.getByRole("heading", { name: "SETTINGS" })).toBeVisible();

    await page.getByLabel("SAFE-AREA GUIDE").check();
    await expect(page.getByTestId("safe-area-guide")).toBeVisible();
    await page.getByLabel(/SIMULATED INSET/).fill("24");
    const inset = await page.locator("html").evaluate((element) => element.style.getPropertyValue("--safe-top"));
    expect(inset).toBe("24px");

    await page.getByRole("button", { name: "RESET SESSION TUNING" }).click();
    await expect(page.getByTestId("safe-area-guide")).toHaveCount(0);
});
