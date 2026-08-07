#!/usr/bin/env node
/**
 * Regression cover for the checkout lockout: a purchase that failed once used
 * to leave a pending intent behind forever, and that intent then swallowed
 * every later tap — including taps on a DIFFERENT product — so the whole shop
 * became unbuyable after a single bad order.
 */
import assert from "node:assert/strict";
import { createPurchaseCoordinator } from "../src/systems/monetization/purchaseCoordinator.ts";

type Harness = ReturnType<typeof harness>;

/** Minimal in-memory stand-in for the RUN shop + the game's save slice. */
function harness(options: {
    purchase: (itemId: string, key: string) => Promise<unknown>;
    orders?: { itemId: string; idempotencyKey: string; status: string }[];
    historyThrows?: boolean;
    classifyError?: (error: unknown) => "cancelled" | "failed" | "unknown";
    nowMs?: () => number;
}) {
    let pending: Record<string, unknown> | null = null;
    let ids = 0;
    const purchaseCalls: string[] = [];
    const coordinator = createPurchaseCoordinator<unknown, { success: boolean; orders: unknown[] }>({
        shop: {
            async purchase(itemId, key) {
                purchaseCalls.push(itemId);
                return options.purchase(itemId, key);
            },
            async getOrderHistory() {
                if (options.historyThrows) throw new Error("history unreachable");
                return { success: true, orders: options.orders ?? [] };
            },
        },
        pending: {
            load: () => pending as never,
            save: (intent) => {
                pending = { ...intent };
            },
            clear: () => {
                pending = null;
            },
        },
        findConfirmedOrder: (history, intent) =>
            history.orders.find(
                (order) =>
                    (order as { idempotencyKey: string }).idempotencyKey === intent.idempotencyKey &&
                    (order as { status: string }).status === "fulfilled",
            ) ?? null,
        syncEntitlements: async () => {},
        classifyError: options.classifyError,
        createId: () => `id-${++ids}`,
        now: options.nowMs ?? (() => 1_000),
    });
    return {
        coordinator,
        purchaseCalls,
        pendingIntent: () => pending,
        seedPending: (intent: Record<string, unknown>) => {
            pending = intent;
        },
    };
}

const staleIntent = (productId: string, createdAtMs: number) => ({
    intentId: `stale-${productId}`,
    productId,
    catalogItemId: `${productId}_item`,
    idempotencyKey: `run-game:${productId}:stale`,
    createdAtMs,
});

const tests: [string, () => Promise<void>][] = [
    [
        "a clean, uncharged decline releases the intent instead of parking it",
        async () => {
            const h: Harness = harness({
                purchase: async () => {
                    throw new Error("Insufficient funds");
                },
                classifyError: () => "failed",
            });
            const outcome = await h.coordinator.purchase("extra_pack", "extra_pack_item");
            assert.equal(outcome.status, "failed");
            assert.equal(h.pendingIntent(), null, "a decline must not leave an intent behind");
        },
    ],
    [
        "an unresolved intent for ANOTHER product no longer blocks a new purchase",
        async () => {
            const h: Harness = harness({
                purchase: async () => ({ success: true }),
                // Old enough that order history has had every chance to settle it.
                nowMs: () => 60 * 60_000,
            });
            h.seedPending(staleIntent("starter_bundle", 0));
            const outcome = await h.coordinator.purchase("extra_pack", "extra_pack_item");
            assert.equal(outcome.status, "confirmed", "the new product must actually reach checkout");
            assert.deepEqual(h.purchaseCalls, ["extra_pack_item"]);
        },
    ],
    [
        "a still-fresh intent for another product is reported, not silently dropped",
        async () => {
            const h: Harness = harness({
                purchase: async () => ({ success: true }),
                nowMs: () => 1_000,
            });
            h.seedPending(staleIntent("starter_bundle", 500));
            const outcome = await h.coordinator.purchase("extra_pack", "extra_pack_item");
            assert.equal(outcome.status, "unknown");
            assert.deepEqual(h.purchaseCalls, [], "a live order must not be raced by a second one");
            assert.notEqual(h.pendingIntent(), null, "and its intent must survive for reconciliation");
        },
    ],
    [
        "an unreadable order history always preserves the intent, however old",
        async () => {
            const h: Harness = harness({
                purchase: async () => ({ success: true }),
                historyThrows: true,
                nowMs: () => 60 * 60_000,
            });
            h.seedPending(staleIntent("starter_bundle", 0));
            const outcome = await h.coordinator.purchase("extra_pack", "extra_pack_item");
            assert.equal(outcome.status, "unknown");
            assert.notEqual(h.pendingIntent(), null, "never abandon an intent we could not check");
            assert.deepEqual(h.purchaseCalls, []);
        },
    ],
    [
        "a stale intent that DID fulfil is still confirmed rather than expired",
        async () => {
            const h: Harness = harness({
                purchase: async () => ({ success: true }),
                orders: [
                    {
                        itemId: "starter_bundle_item",
                        idempotencyKey: "run-game:starter_bundle:stale",
                        status: "fulfilled",
                    },
                ],
                nowMs: () => 60 * 60_000,
            });
            h.seedPending(staleIntent("starter_bundle", 0));
            const outcome = await h.coordinator.purchase("starter_bundle", "starter_bundle_item");
            assert.equal(outcome.status, "confirmed");
            assert.equal(h.pendingIntent(), null);
        },
    ],
    [
        "a passive resume check never retires an intent, however stale",
        async () => {
            const h: Harness = harness({
                purchase: async () => ({ success: true }),
                nowMs: () => 60 * 60_000,
            });
            h.seedPending(staleIntent("starter_bundle", 0));
            const outcome = await h.coordinator.reconcilePending();
            assert.equal(outcome?.status, "unknown");
            assert.notEqual(h.pendingIntent(), null, "boot reconciliation must stay read-only");
        },
    ],
    [
        "re-tapping the same product still replays its original idempotency key",
        async () => {
            const keys: string[] = [];
            const h: Harness = harness({
                purchase: async (_itemId, key) => {
                    keys.push(key);
                    return { success: true };
                },
                nowMs: () => 60 * 60_000,
            });
            h.seedPending(staleIntent("starter_bundle", 0));
            const outcome = await h.coordinator.purchase("starter_bundle", "starter_bundle_item");
            assert.equal(outcome.status, "confirmed");
            assert.deepEqual(keys, ["run-game:starter_bundle:stale"], "a retry must never mint a second key");
        },
    ],
];

let failures = 0;
for (const [name, run] of tests) {
    try {
        await run();
        console.log(`  ok  ${name}`);
    } catch (error) {
        failures += 1;
        console.error(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`);
    }
}

if (failures > 0) {
    console.error(`\nPurchase coordinator checks failed: ${failures}/${tests.length}`);
    process.exit(1);
}
console.log(`Purchase coordinator checks passed: ${tests.length}.`);
