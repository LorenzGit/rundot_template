#!/usr/bin/env node
/**
 * The RUN host reports exactly why a checkout failed. Reading that verdict is
 * what keeps a dismissed top-up sheet or an empty wallet from being displayed
 * as an in-flight order the player can never clear.
 *
 * Codes below are the ones the RUN stack actually emits: the H5 bridge's own
 * snake_case codes for the cases it intercepts, and the shop service's
 * kebab-case codes for everything else.
 */
import assert from "node:assert/strict";
import {
    checkoutErrorCode,
    declineReasonForCode,
    verdictForCode,
    verdictForMessage,
} from "../src/systems/monetization/checkoutClassification.ts";

const failures: string[] = [];
const check = (condition: boolean, message: string) => {
    if (!condition) failures.push(message);
};

// The player backed out of the Run Bits top-up sheet — not an error at all.
check(verdictForCode("USER_CANCELLED") === "cancelled", "a dismissed top-up sheet must read as cancelled");

// Clean, uncharged declines: terminal, so the intent has to be released.
for (const code of [
    "insufficient_funds",
    "insufficient-funds",
    "stale_catalog",
    "stale-catalog",
    "already-owned",
    "item-not-available",
    "velocity-limit",
    "validation-error",
    "unauthenticated",
]) {
    check(verdictForCode(code) === "failed", `${code} is uncharged and must release the intent`);
}

// Genuinely ambiguous: the wallet may already have been touched, so the intent
// must survive to be settled against order history.
for (const code of ["order-in-progress", "internal", "RATE_LIMITED", "some-code-we-have-never-seen"]) {
    check(verdictForCode(code) === "unknown", `${code} must keep the intent for reconciliation`);
}

// Message fallback only ever promotes a case that would otherwise be unknown.
check(verdictForMessage("Purchase cancelled") === "cancelled", "cancel text should still be recognised");
check(verdictForMessage("Insufficient funds") === "failed", "insufficient-funds text should still be recognised");
check(verdictForMessage("Shop service error") === "unknown", "an opaque message must stay unknown");
// The SDK mock rejects an unknown item with code "UNKNOWN" + this message, so
// the dev/playground path must still land on a clean failure, not a stuck order.
check(verdictForMessage("Item not found") === "failed", "the mock's unknown-item rejection is clean");

// Reading the code off a host rejection is what makes any of the above reachable.
check(checkoutErrorCode({ code: "insufficient_funds" }) === "insufficient_funds", "a host code must be read");
check(checkoutErrorCode(new Error("ads.ready timed out")) === null, "a plain timeout carries no code");
check(checkoutErrorCode({ code: "UNKNOWN" }) === null, "the RPC placeholder code says nothing");
check(checkoutErrorCode(null) === null, "a null rejection must not throw");

// Player-facing reasons.
check(declineReasonForCode("insufficient_funds") === "insufficient_funds", "empty wallet should be named");
check(declineReasonForCode("already-owned") === "already_owned", "already-owned should be named");
check(declineReasonForCode("velocity-limit") === "rate_limited", "velocity limit should be named");
check(declineReasonForCode("internal") === null, "never invent a reason for an opaque failure");

if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL  ${failure}`);
    console.error(`\nCheckout classification checks failed: ${failures.length}`);
    process.exit(1);
}
console.log("Checkout classification checks passed.");
