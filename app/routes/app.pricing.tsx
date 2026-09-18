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
 */
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticatePage, authResponse } from "~/utils/shopify-auth.server";
import { billingService, BILLING_PLANS } from "~/services/billing.service";
import type { PlanName } from "~/services/billing.service";
import { generateCsrfToken, validateCsrfRequest } from "~/utils/csrf";
import { getErrorMessage } from "~/utils/errors";
import { createLogger } from "~/utils/logger";

// Re-export the demo component (pure React, no server deps)
export { default } from "~/demo/routes/pricing";

const logger = createLogger({ module: "pricing" });

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — Fetch billing plans and current shop plan
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return authResponse(auth);
  const shop = auth.shop;

  return json({
    currentPlan: (shop.plan || "free") as string,
    plans: BILLING_PLANS,
    shopDomain: shop.shopifyDomain,
    csrfToken: generateCsrfToken(),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTION — Handle subscription creation
// ─────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return authResponse(auth);
  const shop = auth.shop;
  const accessToken = auth.accessToken;

  // CSRF validation for subscription creation (sensitive billing operation)
  let formData: FormData;
  try {
    formData = await validateCsrfRequest(request);
  } catch {
    return json({ error: "Invalid or expired CSRF token. Please refresh the page." }, { status: 403 });
  }
  const planKey = (formData.get("plan") as string || "").trim();

  if (!planKey || !BILLING_PLANS[planKey as keyof typeof BILLING_PLANS]) {
    return json({ error: "Invalid plan selected" }, { status: 400 });
  }

  const plan = BILLING_PLANS[planKey as keyof typeof BILLING_PLANS];

  // Free plan doesn't need billing
  if (plan.price === 0) {
    return json({ info: "You are already on the Free plan" });
  }

  try {
    const result = await billingService.createSubscription(
      shop.shopifyDomain,
      planKey as PlanName,
      accessToken
    );

    if ("confirmationUrl" in result && result.confirmationUrl) {
      // Return JSON so the client can redirect via window.open(url, "_top")
      return json({ confirmationUrl: result.confirmationUrl });
    }

    if ("error" in result) {
      return json({ error: result.error }, { status: 400 });
    }

    return json({ error: "Unexpected response from billing service" }, { status: 500 });
  } catch (error) {
    logger.error(
      { shop: shop.shopifyDomain, plan: planKey, error: getErrorMessage(error) },
      "Failed to create subscription"
    );
    return json({ error: "Failed to create subscription. Please try again." }, { status: 500 });
  }
};
