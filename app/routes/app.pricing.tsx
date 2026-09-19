/**
 * File: routes/app.pricing.tsx
 * Author: yuntongsoft
 * Date: 2026/09/08
 * Purpose: [DEMO] Pricing page — route wrapper with server-side logic
 *
 * ============================================================================
 * DEMO ROUTE — Delete this file + app/demo/ to remove all demo code
 * ============================================================================
 *
 * Server-only imports live HERE (in app/routes/) so Remix's Vite plugin
 * strips them from the client bundle. The demo component in app/demo/
 * only contains pure React code.
 *
 * Architecture (matches traffic-guard):
 *   - Loader: auth + proactive Shopify API sync (webhook timing fix)
 *   - No action — subscription creation handled by /api/billing (returns JSON)
 *   - Frontend fetches /api/billing directly, avoiding SSR HTML parsing
 *
 * Dependencies: shopify-auth.server, billing.service, prisma
 */
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { authenticatePage, isValidShopDomain, authResponse, extractIdToken, refreshExpiringToken } from "~/utils/shopify-auth.server";
import { billingService, BILLING_PLANS } from "~/services/billing.service";
import prisma from "~/db.server";
import { createLogger } from "~/utils/logger";

// Re-export the demo component (pure React, no server deps)
export { default } from "~/demo/routes/pricing";

const logger = createLogger({ module: "pricing" });

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — Fetch billing plans and current shop plan
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Pricing page loader — auth with fallback for Shopify confirmation callback.
 *
 * Uses authenticatePage (custom implementation) instead of authenticate.admin (SDK).
 * When Shopify redirects back from the subscription confirmation page, it's a
 * top-level navigation (no App Bridge). authenticatePage returns { ok: false }
 * in that case, so we fall back to accepting the URL `shop` param.
 *
 * Webhook timing fix: When DB plan is "free", we proactively query Shopify's
 * GraphQL API to check for active subscriptions. The APP_SUBSCRIPTIONS_UPDATE
 * webhook may not have arrived yet when the user returns from the confirmation page.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticatePage(request);
  let shopDomain: string;
  let idToken: string | undefined;

  if (auth.ok) {
    shopDomain = auth.shop.shopifyDomain;
    idToken = extractIdToken(request);
  } else if ("needsRefresh" in auth) {
    // Token exchange failed — return bounce redirect
    return authResponse(auth);
  } else {
    // authenticatePage failed — likely no session token (Shopify billing confirmation callback)
    // Only accept shop param when it looks like a billing callback redirect
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const isBillingCallback = url.searchParams.has("charge_id") || url.pathname.includes("pricing");

    if (!shop || !isValidShopDomain(shop) || !isBillingCallback) {
      return auth.response;
    }

    const existingShop = await prisma.shop.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true },
    });
    if (!existingShop) {
      return auth.response;
    }

    logger.warn({ shop }, "authenticatePage failed, falling back to shop param for pricing callback");
    shopDomain = shop;
  }

  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { plan: true },
  });

  let currentPlan = (shop?.plan || "free") as string;

  // Webhook timing fix: DB says "free" but user just subscribed — query Shopify directly
  if (currentPlan === "free" && idToken) {
    try {
      const accessToken = await refreshExpiringToken(shopDomain, idToken);
      const sub = await billingService.hasActiveSubscription(shopDomain, accessToken);
      if (sub.active && sub.planName) {
        // Map Shopify plan name to our plan key
        const planKey = Object.entries(BILLING_PLANS).find(
          ([, v]) => v.apiName.toLowerCase() === sub.planName!.toLowerCase()
        )?.[0];
        if (planKey && planKey !== "free") {
          await prisma.shop.updateMany({
            where: { shopifyDomain: shopDomain },
            data: { plan: planKey },
          });
          currentPlan = planKey;
          logger.info({ shop: shopDomain, plan: planKey }, "Plan synced from Shopify API (webhook not yet received)");
        }
      }
    } catch (error) {
      // Non-fatal — webhook will eventually update the plan
      logger.warn({ shop: shopDomain, error: String(error) }, "Failed to sync plan from Shopify API");
    }
  }

  return json({
    currentPlan,
    plans: BILLING_PLANS,
    shopDomain,
  });
};
