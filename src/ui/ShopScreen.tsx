import { useEffect, useState } from "react";
import { audioManager } from "../audio/audioManager.ts";
import { getRunCapabilities } from "../sdk/runSdk.ts";
import { formatNumber, t } from "../systems/localization.ts";
import {
    checkoutDeclineReason,
    productView,
    purchaseProduct,
    reconcilePendingPurchase,
    refreshCommerce,
    validateCatalogInDevelopment,
} from "../systems/monetization/commerce.ts";
import { analytics } from "../systems/analytics/analyticsConfig.ts";
import { runtimeServices } from "../systems/runtimeServices.ts";
import { store, useStore } from "../state/store.ts";
import MenuScreenLayout from "./MenuScreenLayout.tsx";

/** ADAPT: localize these alongside the rest of your player-facing copy. */
const DECLINE_TOASTS: Readonly<Record<"insufficient_funds" | "already_owned" | "rate_limited" | "generic", string>> = {
    insufficient_funds: "NOT ENOUGH RUN BITS",
    already_owned: "ALREADY OWNED",
    rate_limited: "TOO MANY ORDERS — TRY AGAIN SHORTLY",
    generic: "PURCHASE FAILED",
};

export default function ShopScreen() {
    useStore(
        (state) =>
            `${state.locale}:${state.ownedProductIds.join(",")}:${state.pendingPurchaseIntent?.idempotencyKey ?? ""}:${state.runtimeReady}`,
    );
    const [busy, setBusy] = useState(false);
    const [, setCommerceSync] = useState(0);

    useEffect(() => {
        let disposed = false;
        // Step 1 of the declared purchase funnel — the conversion arc starts
        // the moment the shop actually paints, not at checkout.
        analytics.funnelStep("purchase", 1);
        // An interrupted checkout reconciles before the player can tap the
        // card again; ownership and live prices refresh on every shop open.
        void (async () => {
            await reconcilePendingPurchase();
            await refreshCommerce();
            await validateCatalogInDevelopment();
            if (!disposed) setCommerceSync((count) => count + 1);
        })();
        return () => {
            disposed = true;
        };
    }, []);

    // ADAPT: replace the demo cards with your products from
    // src/systems/monetization/config.ts, one card per registry entry.
    const bundle = productView("starter_bundle");
    const capabilities = getRunCapabilities();
    const unavailable =
        capabilities.purchases || capabilities.ads
            ? "LIVEOPS + PLACEHOLDER IDS NOT CONFIGURED"
            : t("SettingsUnavailable");

    const numericPrice = bundle.price !== null ? Number(bundle.price) : Number.NaN;
    const priceLabel =
        bundle.price === null
            ? "PRICE NOT SYNCED"
            : Number.isFinite(numericPrice)
              ? `${formatNumber(numericPrice)} RUN BITS`
              : bundle.price;

    const buy = async () => {
        await audioManager.unlock();
        setBusy(true);
        // Steps 2 and 3 are adjacent in this one-card demo shop. ADAPT: in a
        // real catalog, fire item_selected when a product is focused/opened and
        // checkout_started only when the host sheet is actually requested.
        analytics.funnelStep("purchase", 2, { product_id: bundle.productId });
        analytics.funnelStep("purchase", 3, { product_id: bundle.productId });
        const outcome = await purchaseProduct(bundle.productId);
        setBusy(false);
        if (!outcome) {
            store.patch({ toast: "PURCHASE NOT STARTED" });
        } else if (outcome.status === "confirmed") {
            analytics.funnelStep("purchase", 4, { product_id: bundle.productId });
            store.patch({ toast: `${bundle.name} OWNED` });
            audioManager.play("reward");
            void runtimeServices.haptic("success");
        } else if (outcome.status === "cancelled") {
            store.patch({ toast: "CHECKOUT CANCELLED" });
        } else if (outcome.status === "unknown") {
            // The order may still settle; the pending intent survives and
            // reconciles on the next shop open or resume.
            store.patch({ toast: "ORDER PENDING — CHECKING AGAIN SOON" });
        } else {
            // ADAPT: the host names the common declines, so say what happened —
            // "PURCHASE FAILED" on an empty wallet reads as a broken shop
            // rather than something the player can act on.
            store.patch({ toast: DECLINE_TOASTS[checkoutDeclineReason(outcome.error) ?? "generic"] });
            audioManager.play("error");
        }
    };

    return (
        <MenuScreenLayout title={t("MenuShop")} kicker="MONETIZATION / FAIL-CLOSED">
            <p className="screen-copy">{t("ShopBody")}</p>
            <article className="shop-card">
                <p className="eyebrow">REWARDED PLACEMENT</p>
                <h3>RESULTS BONUS</h3>
                <p>Reward: {formatNumber(100)} placeholder soft currency</p>
                <button type="button" disabled>
                    {unavailable}
                </button>
            </article>
            <article className="shop-card">
                <p className="eyebrow">RUN SHOP PRODUCT</p>
                <h3>{bundle.name}</h3>
                <p>
                    {bundle.owned
                        ? bundle.ownedFromSave
                            ? // The host could not be asked, so ownership rests on the
                              // save's last authoritative read — never revoked by a
                              // failed entitlement sync.
                              "OWNED · SAVED RECORD"
                            : "OWNED"
                        : priceLabel}
                </p>
                {bundle.pendingReconciliation && !bundle.owned ? <p>LAST ORDER STILL SETTLING</p> : null}
                <button type="button" disabled={busy || bundle.owned || !bundle.purchasable} onClick={() => void buy()}>
                    {busy
                        ? "OPENING CHECKOUT..."
                        : bundle.owned
                          ? "OWNED"
                          : bundle.purchasable
                            ? bundle.pendingReconciliation
                                ? "RETRY LAST ORDER"
                                : `BUY ${bundle.name}`
                            : unavailable}
                </button>
            </article>
            <p className="safety-note">
                Ownership is asserted only from RUN entitlements or the save's last authoritative read of them; this
                screen never grants anything locally.
            </p>
        </MenuScreenLayout>
    );
}
