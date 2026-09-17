/**
 * File: billing.service.ts
 * Author: yuntongsoft
 * Date: 2026/08/28
 * Purpose: Shopify Billing API — subscription CRUD, plan management
 *
 * Dependencies: prisma, logger, shopify.service.ts
 * Used by: webhook-registry.ts (subscription lifecycle), routes/app.pricing.tsx
 *
 * Usage:
 *   import { billingService } from "~/services/billing.service";
 *   const result = await billingService.createSubscription(shop, "pro", token);
 */
import prisma from "~/db.server";
import { createLogger } from "~/utils/logger";
import { shopifyAdmin } from "~/services/shopify";
import { getErrorMessage } from "~/utils/errors";

const logger = createLogger({ module: "billing-service" });

/**
 * Plan definitions — align with Shopify Billing API
 * Customize these to match your pricing strategy.
 */
export const BILLING_PLANS = {
  free: {
    name: "Free",
    price: 0,
    interval: "EVERY_30_DAYS" as const,
    trialDays: 0,
    description: "Basic features to get started",
  },
  pro: {
    name: "Pro",
    price: 9.99,
    interval: "EVERY_30_DAYS" as const,
    trialDays: 7,
    description: "Advanced features for growing businesses",
  },
  business: {
    name: "Business",
    price: 29.99,
    interval: "EVERY_30_DAYS" as const,
    trialDays: 7,
    description: "Everything in Pro plus priority support and API access",
  },
} as const;

export type PlanName = keyof typeof BILLING_PLANS;

export class BillingService {
  /**
   * Get the current plan for a shop
   */
  async getShopPlan(shopId: string): Promise<PlanName> {
    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: { plan: true },
    });
    return (shop?.plan as PlanName) || "free";
  }

  /**
   * Create a Shopify subscription via GraphQL Admin API
   * Returns confirmation URL for the merchant to approve
   */
  async createSubscription(
    shopDomain: string,
    planName: PlanName,
    accessToken: string
  ): Promise<{ confirmationUrl: string } | { error: string }> {
    const plan = BILLING_PLANS[planName];
    if (!plan || plan.price === 0) {
      return { error: "Cannot create subscription for free plan" };
    }

    const mutation = `
      mutation appSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean!, $trialDays: Int) {
        appSubscriptionCreate(name: $name, lineItems: $lineItems, returnUrl: $returnUrl, test: $test, trialDays: $trialDays) {
          appSubscription { id status }
          confirmationUrl
          userErrors { field message }
        }
      }
    `;

    // Default to real billing — set SHOPIFY_BILLING_TEST=true explicitly for dev/test
    const isTest = process.env.SHOPIFY_BILLING_TEST === "true";

    try {
      const api = shopifyAdmin(shopDomain);

      // Fetch shop currency — Billing API requires the shop's local currency
      let currencyCode = "USD";
      try {
        const shopInfo = await api.getShopInfo();
        if (shopInfo.currency) currencyCode = shopInfo.currency;
      } catch {
        logger.warn({ shopDomain }, "Failed to fetch shop currency, defaulting to USD");
      }

      const data = await api.graphql<{
        appSubscriptionCreate: {
          appSubscription: { id: string; status: string } | null;
          confirmationUrl: string | null;
          userErrors: Array<{ field: string[] | null; message: string }>;
        };
      }>(mutation, {
        name: plan.name,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: plan.price, currencyCode },
                interval: plan.interval,
              },
            },
          },
        ],
        returnUrl: `https://${shopDomain}/admin/apps`,
        test: isTest,
        trialDays: plan.trialDays,
      });

      const result = data.appSubscriptionCreate;

      if (result.userErrors?.length > 0) {
        logger.error({ shopDomain, errors: result.userErrors }, "Failed to create subscription");
        return { error: result.userErrors[0].message };
      }

      if (!result.confirmationUrl) {
        logger.error({ shopDomain }, "No confirmation URL returned by Shopify");
        return { error: "No confirmation URL returned" };
      }

      logger.info({ shopDomain, planName }, "Subscription created");
      return { confirmationUrl: result.confirmationUrl };
    } catch (error) {
      logger.error({ shopDomain, error: getErrorMessage(error) }, "Failed to create subscription");
      return { error: getErrorMessage(error) };
    }
  }

  /**
   * Handle subscription activation (from APP_SUBSCRIPTIONS_UPDATE webhook)
   */
  async handleSubscriptionActivated(shop: string, name: string, status: string): Promise<void> {
    const planKey = Object.entries(BILLING_PLANS).find(
      ([, v]) => v.name.toLowerCase() === name.toLowerCase()
    )?.[0] as PlanName | undefined;

    if (!planKey) {
      logger.warn({ shop, name }, "Unknown plan name in subscription activation");
      return;
    }

    await prisma.shop.updateMany({
      where: { shopifyDomain: shop },
      data: { plan: planKey },
    });
    logger.info({ shop, plan: planKey, status }, "Subscription activated");
  }

  /**
   * Handle subscription deactivation (cancelled/declined/expired)
   */
  async handleSubscriptionDeactivated(shop: string): Promise<void> {
    await prisma.shop.updateMany({
      where: { shopifyDomain: shop },
      data: { plan: "free" },
    });
    logger.info({ shop }, "Subscription deactivated, downgraded to free");
  }
}

export const billingService = new BillingService();
