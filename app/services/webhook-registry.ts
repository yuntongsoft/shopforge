/**
 * File: services/webhook-registry.ts
 * Author: yuntongsoft
 * Date: 2026/09/02
 * Purpose: Centralized webhook handler registry — developers register handlers
 *          without touching the webhook route or knowing Shopify webhook mechanics.
 *
 * Usage (for developers):
 *   import { webhookRegistry } from "~/services/webhook-registry";
 *
 *   webhookRegistry.on("ORDERS_CREATE", async (shop, payload) => {
 *     console.log(`New order: ${payload.name}`);
 *   });
 *
 * Built-in handlers (auto-registered):
 *   - APP_UNINSTALLED → soft-delete shop data
 *   - APP_SUBSCRIPTIONS_UPDATE → billing subscription lifecycle
 *   - CUSTOMERS_DATA_REQUEST / CUSTOMERS_REDACT / SHOP_REDACT → GDPR compliance
 *
 * Dependencies: prisma, billing.service, logger
 */
import prisma from "~/db.server";
import { createLogger } from "~/utils/logger";
import { getErrorMessage } from "~/utils/errors";
import { billingService } from "~/services/billing.service";
import { withRetry } from "~/utils/retry";

const logger = createLogger({ module: "webhook-registry" });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Webhook topic strings supported by Shopify.
 *
 * NOTE: Topics use SCREAMING_SNAKE_CASE (e.g. "APP_UNINSTALLED") which matches
 * the Shopify GraphQL Admin API enum values. The Shopify CLI's shopify.app.toml
 * uses a different format (e.g. "app/uninstalled"), but the SDK's internal
 * topicForStorage() normalizes both formats to this uppercase form:
 *   topic.toUpperCase().replace(/\/|\./g, '_')
 * So "app/uninstalled" → "APP_UNINSTALLED" — both resolve to the same key.
 * buildWebhookConfig() in shopify.server.ts passes these directly as GraphQL
 * enum values in webhookSubscriptionCreate mutations, which is correct.
 */
export type WebhookTopic =
  | "APP_UNINSTALLED"
  | "APP_SUBSCRIPTIONS_UPDATE"
  | "ORDERS_CREATE"
  | "ORDERS_UPDATED"
  | "ORDERS_PAID"
  | "ORDERS_FULFILLED"
  | "PRODUCTS_CREATE"
  | "PRODUCTS_UPDATE"
  | "PRODUCTS_DELETE"
  | "CUSTOMERS_CREATE"
  | "CUSTOMERS_UPDATE"
  | "CUSTOMERS_DATA_REQUEST"
  | "CUSTOMERS_REDACT"
  | "SHOP_REDACT"
  | "CHECKOUTS_CREATE"
  | "CHECKOUTS_UPDATE"
  | "CHECKOUTS_DELETE"
  | (string & {}); // Allow arbitrary topics while providing autocomplete

/** Handler function signature — developer only sees shop domain + payload */
export type WebhookHandler = (shop: string, payload: unknown) => void | Promise<void>;

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export class WebhookRegistry {
  private handlers = new Map<string, WebhookHandler[]>();

  /**
   * Register a handler for a webhook topic.
   * Multiple handlers per topic are supported (called in registration order).
   *
   * @param topic - Shopify webhook topic (e.g. "ORDERS_CREATE")
   * @param handler - Function called with (shop, payload)
   */
  on(topic: WebhookTopic, handler: WebhookHandler): void {
    const existing = this.handlers.get(topic) || [];
    existing.push(handler);
    this.handlers.set(topic, existing);
    logger.debug({ topic }, "Webhook handler registered");
  }

  /**
   * Dispatch a webhook to all registered handlers.
   * Called by routes/webhooks.tsx — developers never call this directly.
   *
   * @returns true if at least one handler was found and executed
   */
  async dispatch(topic: string, shop: string, payload: unknown): Promise<boolean> {
    const topicHandlers = this.handlers.get(topic);

    if (!topicHandlers || topicHandlers.length === 0) {
      logger.warn({ shop, topic }, "No handler registered for webhook topic");
      return false;
    }

    for (const handler of topicHandlers) {
      try {
        await withRetry(
          async () => { await handler(shop, payload); },
          {
            maxRetries: 2,
            baseDelayMs: 500,
            maxDelayMs: 2000,
            label: `webhook:${topic}`,
          }
        );
      } catch (error) {
        logger.error(
          { shop, topic, error: getErrorMessage(error) },
          "Webhook handler failed after retries"
        );
        // Continue executing remaining handlers even if one fails
      }
    }

    return true;
  }

  /**
   * Get all registered topics — used by shopify.server.ts to auto-configure
   * webhook subscriptions so developers don't need to declare them manually.
   */
  getRegisteredTopics(): string[] {
    return Array.from(this.handlers.keys());
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton instance with built-in handlers
// ─────────────────────────────────────────────────────────────────────────────

export const webhookRegistry = new WebhookRegistry();

// ── Built-in: APP_UNINSTALLED → soft-delete shop ──
webhookRegistry.on("APP_UNINSTALLED", async (shop) => {
  logger.info({ shop }, "App uninstalled, soft-deleting shop data");
  await prisma.shop.updateMany({
    where: { shopifyDomain: shop },
    data: { isDeleted: true },
  });
});

// ── Built-in: APP_SUBSCRIPTIONS_UPDATE → billing lifecycle ──
webhookRegistry.on("APP_SUBSCRIPTIONS_UPDATE", async (shop, payload) => {
  logger.info({ shop }, "Subscription updated");
  const subscription = payload as { app_subscription?: { name?: string; status?: string } };
  const status = subscription.app_subscription?.status;
  const name = subscription.app_subscription?.name || "";

  if (status === "ACTIVE" || status === "ACCEPTED") {
    await billingService.handleSubscriptionActivated(shop, name, status);
  } else if (status === "CANCELLED" || status === "DECLINED" || status === "EXPIRED") {
    await billingService.handleSubscriptionDeactivated(shop);
  }
});

// ── Built-in: GDPR — Customer data request ──
// ShopForge does NOT store customer PII (names, emails, addresses, etc.).
// Only shop-level data is stored (shop domain, encrypted token, plan, locale).
// If you add customer data storage, you MUST export it here per GDPR requirements.
webhookRegistry.on("CUSTOMERS_DATA_REQUEST", async (shop) => {
  logger.info({ shop }, "Customer data request (GDPR) — no customer PII stored, acknowledging");
});

// ── Built-in: GDPR — Customer redact ──
// ShopForge does NOT store customer PII. This handler acknowledges the webhook.
// If you add customer data storage, you MUST delete it here per GDPR requirements.
webhookRegistry.on("CUSTOMERS_REDACT", async (shop) => {
  logger.info({ shop }, "Customer redact request (GDPR) — no customer PII stored, acknowledging");
});

// ── Built-in: GDPR — Shop redact (hard delete, legal requirement) ──
webhookRegistry.on("SHOP_REDACT", async (shop) => {
  logger.info({ shop }, "Shop redact request, hard-deleting all data (GDPR)");
  await prisma.$transaction(async (tx) => {
    const shopRecord = await tx.shop.findUnique({
      where: { shopifyDomain: shop },
      select: { id: true },
    });
    if (!shopRecord) return;
    await tx.session.deleteMany({ where: { shop } });
    await tx.shop.delete({ where: { id: shopRecord.id } });
  });
  logger.info({ shop }, "Shop redact completed");
});

