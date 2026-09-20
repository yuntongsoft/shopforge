/**
 * File: routes/api.billing.ts
 * Purpose: Billing API — subscription CRUD
 *
 * POST: Create subscription, returns confirmationUrl for Shopify redirect
 *
 * Architecture: Separated from page routes so the response is always JSON.
 * Remix page routes (app.pricing.tsx) return SSR HTML — parsing it in JS is fragile.
 * A dedicated API route avoids that entirely.
 *
 * Dependencies: shopify-auth.server, billing.service, prisma
 */
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticatePage, extractIdToken, refreshExpiringToken } from "~/utils/shopify-auth.server";
import { billingService, BILLING_PLANS, type PlanName } from "~/services/billing.service";
import prisma from "~/db.server";
import { createLogger } from "~/utils/logger";
import { apiError, apiSuccess } from "~/utils/api-response";

const logger = createLogger({ module: "api-billing" });

/**
 * POST /api/billing — Create subscription
 * Body: FormData { plan: "pro" }
 *
 * Returns { confirmationUrl } on success, { error } on failure.
 * No CSRF validation — Shopify session token auth is sufficient for embedded apps.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) {
    logger.error("Billing action authentication failed");
    return apiError("Authentication required", 401);
  }
  const shopDomain = auth.shop.shopifyDomain;

  const formData = await request.formData();
  const plan = formData.get("plan") as string;

  const validPlans = Object.keys(BILLING_PLANS).filter((k) => k !== "free");
  if (!validPlans.includes(plan)) {
    logger.error({ plan }, "Invalid plan submitted");
    return apiError("Invalid plan", 400);
  }

  // Get access token via Token Exchange (Shopify 2026-07+ expiring tokens)
  const idToken = extractIdToken(request);
  let accessToken: string;
  try {
    accessToken = await refreshExpiringToken(shopDomain, idToken);
  } catch (error) {
    logger.error({ shopDomain, error: String(error) }, "Failed to get access token");
    return apiError("Failed to authenticate. Please reload the page and try again.", 500);
  }

  // Prevent duplicate active subscriptions — but sync DB if webhook was missed
  const existingSub = await billingService.hasActiveSubscription(shopDomain, accessToken);
  if (existingSub.active) {
    logger.warn({ shopDomain, existingPlan: existingSub.planName }, "Duplicate subscription attempt blocked");

    // Webhook may have been missed — sync the plan from Shopify's truth
    if (existingSub.planName) {
      const planKey = Object.entries(BILLING_PLANS).find(
        ([, v]) => v.apiName.toLowerCase() === existingSub.planName!.toLowerCase()
      )?.[0] as PlanName | undefined;
      if (planKey && planKey !== "free") {
        await prisma.shop.updateMany({
          where: { shopifyDomain: shopDomain },
          data: { plan: planKey },
        });
        logger.info({ shopDomain, plan: planKey }, "Plan synced from duplicate check (webhook was missed)");
      }
    }

    return apiError("already_subscribed", 409);
  }

  // Create subscription
  const result = await billingService.createSubscription(shopDomain, plan as PlanName, accessToken);

  if ("error" in result) {
    logger.error({ shopDomain, plan, error: result.error }, "Subscription creation failed");
    return apiError(result.error, 500);
  }

  logger.info({ shop: shopDomain, plan }, "Subscription created, returning confirmation URL");
  return apiSuccess({ confirmationUrl: result.confirmationUrl });
};

export { PageErrorBoundary as ErrorBoundary } from "~/components/PageErrorBoundary";
