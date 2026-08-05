/**
 * The template's demo monetization decisions, in code.
 *
 * Nothing else in the game may invent a product id, a price, or an unlock
 * gate — if it is not here, it does not exist. Every entry below is a demo
 * stand-in: a fork replaces the content but keeps the shape, so that the
 * registries stay the single source of truth for what money can buy.
 */
import { PLATFORM_IDS } from "../../config/platform.ts";
import { createMonetizationPlan } from "./monetizationPlan.ts";
import { createProductRegistry } from "./productRegistry.ts";

export const monetizationPlan = createMonetizationPlan({
    // ADAPT: rewrite every field for your game (see docs/monetization.md)
    // before exposing a monetized surface. This demo plan documents the
    // template's own posture: the loop is complete without spending.
    model: "hybrid",
    nonPayerPromise:
        "The demo loop is fully playable free: no purchase changes scoring, difficulty, or progression. The starter bundle only exercises the RUN shop vertical slice, and the rewarded placement pays the same soft currency the loop already grants.",
    purchaseArchitecture: "shop-entitlements",
    architectureRationale:
        "A durable unlock must survive a reinstall or device change, which needs the platform's entitlement record and order ledger; a client-owned flag would be lost the first time a player moved devices.",
    firstExposure: {
        valueMoment: "The player has finished at least one demo round and seen the results value its bonus.",
        minCompletedSessions: 1,
        minProgression: 1,
    },
    primaryKpis: ["game_payer_conversion"],
    guardrails: {
        retention: "D1/D7 retention split by shop-exposure cohort",
        sessionHealth: "rounds per session before and after the first shop visit",
        economyHealth: "share of soft currency from rewarded ads versus play",
        reliability: "purchase and ad error rate excluding player cancellation",
    },
});

export const products = createProductRegistry([
    // ADAPT: replace the demo starter bundle with your game's products. The
    // catalog and entitlement ids come from src/config/platform.ts and must
    // match rundot/shop.config.json exactly; untouched REPLACE_WITH_ values
    // keep the whole surface fail-closed.
    {
        id: "starter_bundle",
        catalogItemId: PLATFORM_IDS.starterBundleItem,
        kind: "bundle",
        expectedEntitlementIds: [PLATFORM_IDS.starterBundleEntitlement],
        unique: true,
        unlockDescription: "Offered once the player has finished at least one demo round",
    },
]);

// ADAPT: extend this union alongside the registry above.
export type ProductId = "starter_bundle";

/** Fallback display names for when the live catalog has not resolved. */
export const PRODUCT_NAMES: Readonly<Record<ProductId, string>> = {
    starter_bundle: "STARTER BUNDLE",
};
