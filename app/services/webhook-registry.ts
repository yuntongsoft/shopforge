/**
 * File: services/webhook-registry.ts
 * Author: yuntongsoft
 * Date: 2026/09/02
 * Purpose: Centralized webhook handler registry — developers register handlers
 *          without touching the webhook route or knowing Shopify webhook mechanics.
 *
 * Supports both synchronous and asynchronous (queue-based) processing:
 *   - Sync handlers: executed immediately during webhook dispatch (lightweight operations)
 *   - Async handlers: enqueued for background processing (heavy operations that may
 *     exceed Shopify's ~5s webhook timeout)
 *
 * Usage (for developers):
 *   import { webhookRegistry } from "~/services/webhook-registry";
 *
 *   // Synchronous handler (default) — for lightweight operations
 *   webhookRegistry.on("APP_UNINSTALLED", async (shop, payload) => {
 *     console.log(`App uninstalled from ${shop}`);
 *   });
 *
 *   // Asynchronous handler — for heavy processing (API calls, batch operations)
 *   webhookRegistry.on("ORDERS_CREATE", async (shop, payload) => {
 *     // This runs in the background queue, won't block webhook response
 *     await processOrder(shop, payload);
 *   }, { async: true });
 *
 * Built-in handlers (auto-registered):
 *   - APP_UNINSTALLED → soft-delete shop, clear sessions, reset credentials
 *   - APP_SUBSCRIPTIONS_UPDATE → billing subscription lifecycle
 *   - CUSTOMERS_DATA_REQUEST / CUSTOMERS_REDACT / SHOP_REDACT → GDPR compliance
 *
 * Dependencies: prisma, billing.service, logger, webhook-queue
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
  | "ORDERS_REFUNDED"
  | "ORDERS_CANCELLED"
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
  | (string & Record<string, never>); // Allow arbitrary topics while providing autocomplete

/**
 * Handler function signature.
 *
 * @param shop - Shop domain (e.g. "mystore.myshopify.com")
 * @param payload - Webhook payload (type varies by topic)
 * @param webhookId - X-Shopify-Webhook-Id for idempotent dedup. Shopify retries
 *   unacknowledged events with the same ID; the queue uses it for dedup constraint.
 */
export type WebhookHandler = (
  shop: string,
  payload: unknown,
  webhookId?: string
) => void | Promise<void>;

/** Registration options */
interface RegisterOptions {
  /**
   * When true, this handler runs asynchronously via the webhook job queue.
   * The webhook route persists the job and returns 200 immediately;
   * a background consumer processes it with retry, dedup, and dead-letter support.
   *
   * Use async for handlers that:
   * - Make Shopify Admin API calls (may exceed 5s webhook timeout)
   * - Perform batch database operations
   * - Call external services
   *
   * Default: false (synchronous execution with retry)
   */
  async?: boolean;
}

interface HandlerEntry {
  handler: WebhookHandler;
  isAsync: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

export class WebhookRegistry {
  private handlers = new Map<string, HandlerEntry[]>();

  /**
   * Register a handler for a webhook topic.
   * Multiple handlers per topic are supported (called in registration order).
   *
   * @param topic - Shopify webhook topic (e.g. "ORDERS_CREATE")
   * @param handler - Function called with (shop, payload, webhookId?)
   * @param options - Pass { async: true } for queue-based background processing
   */
  on(topic: WebhookTopic, handler: WebhookHandler, options?: RegisterOptions): void {
    const existing = this.handlers.get(topic) || [];
    existing.push({ handler, isAsync: options?.async ?? false });
    this.handlers.set(topic, existing);
    logger.debug({ topic, isAsync: options?.async ?? false }, "Webhook handler registered");
  }

  /**
   * Dispatch a webhook to all registered handlers.
   * Called by routes/webhooks.tsx — developers never call this directly.
   *
   * Sync handlers are executed inline with retry.
   * Async handlers are enqueued for background processing via webhook-queue.
   *
   * @param topic - Shopify webhook topic (SCREAMING_SNAKE_CASE)
   * @param shop - Shop domain
   * @param payload - Webhook payload
   * @param webhookId - X-Shopify-Webhook-Id for idempotent dedup
   * @returns true if at least one handler was found
   */
  async dispatch(topic: string, shop: string, payload: unknown, webhookId?: string): Promise<boolean> {
    const entries = this.handlers.get(topic);

    if (!entries || entries.length === 0) {
      logger.warn({ shop, topic }, "No handler registered for webhook topic");
      return false;
    }

    let enqueued = false;

    for (const entry of entries) {
      if (entry.isAsync) {
        // Enqueue exactly once per topic — dispatchHandlers() will run ALL async
        // handlers when the job is consumed. Enqueuing per-handler would cause N²
        // execution (N handlers × N jobs).
        if (!enqueued) {
          const { enqueueWebhook } = await import("~/services/webhook-queue");
          await enqueueWebhook(topic, shop, payload, webhookId);
          enqueued = true;
        }
      } else {
        try {
          await withRetry(
            async () => { await entry.handler(shop, payload, webhookId); },
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
        }
      }
    }

    return true;
  }

  /**
   * Execute async handlers only (no enqueue, no retry wrapper).
   * Called by the webhook queue consumer after claiming a job — the queue
   * handles its own retry/dead-letter lifecycle.
   *
   * Sync handlers are NOT executed here — they already ran inline during dispatch().
   * Only async handlers (the ones that triggered the enqueue) are executed.
   *
   * @internal Used by webhook-queue.ts — not part of the public developer API.
   */
  async dispatchHandlers(topic: string, shop: string, payload: unknown, webhookId?: string): Promise<void> {
    const entries = this.handlers.get(topic);
    if (!entries || entries.length === 0) {
      logger.warn({ shop, topic }, "No handler registered for queued topic");
      return;
    }

    for (const entry of entries) {
      if (entry.isAsync) {
        await entry.handler(shop, payload, webhookId);
      }
    }
  }

  /**
   * Remove a handler (or all handlers for a topic).
   *
   * @param topic - Webhook topic
   * @param handler - Specific handler to remove. If omitted, all handlers for the topic are removed.
   */
  off(topic: WebhookTopic, handler?: WebhookHandler): void {
    if (!handler) {
      this.handlers.delete(topic);
      logger.debug({ topic }, "All webhook handlers removed for topic");
      return;
    }
    const entries = this.handlers.get(topic);
    if (!entries) return;
    const filtered = entries.filter((e) => e.handler !== handler);
    if (filtered.length > 0) {
      this.handlers.set(topic, filtered);
    } else {
      this.handlers.delete(topic);
    }
    logger.debug({ topic }, "Webhook handler removed");
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

// ── Built-in: APP_UNINSTALLED → soft-delete shop + clear sessions + reset ──
// Production-hardened pattern from DealCraft (2026-09):
// 1. Delete all OAuth sessions — stale tokens cause 403s in cron/SDK retries
// 2. Soft-delete shop + reset credentials — prevents re-install confusion
// 3. Reset subscription state — Shopify cancels subscriptions on uninstall
// Marked async: session.deleteMany + shop.updateMany can exceed Shopify's 5s webhook timeout on large stores.
webhookRegistry.on("APP_UNINSTALLED", async (shop) => {
  logger.info({ shop }, "App uninstalled: soft-deleting shop, clearing sessions and credentials");

  // 1. Delete all OAuth sessions (including offline_<domain>).
  //    Sessions have no FK to Shop (OAuth stores them before Shop exists),
  //    so we must delete them explicitly.
  try {
    await prisma.session.deleteMany({ where: { shop } });
  } catch (e) {
    logger.warn({ shop, error: getErrorMessage(e) }, "Failed to delete sessions on uninstall");
  }

  // 2. Soft-delete shop + reset credentials and state:
  //    - shopifyToken kept (NOT NULL) but isDeleted=true blocks auth fast path
  //    - subscriptionId/status cleared: Shopify cancels subscriptions on uninstall.
  //      If not reset, reinstall shows old paid plan (revenue leak + review rejection)
  //    - pending* fields cleared: stale pending state confuses re-install flow
  try {
    await prisma.shop.updateMany({
      where: { shopifyDomain: shop },
      data: {
        isDeleted: true,
        subscriptionId: null,
        subscriptionStatus: "NONE",
        subscriptionCheckedAt: null,
        pendingSubscriptionId: null,
        pendingPlan: null,
        pendingConfirmation: null,
        initializedAt: null,
      },
    });
  } catch (e) {
    logger.warn({ shop, error: getErrorMessage(e) }, "Failed to reset shop state on uninstall");
  }
}, { async: true });

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
webhookRegistry.on("CUSTOMERS_DATA_REQUEST", async (shop, payload) => {
  const gdprPayload = payload as { customer?: { email?: string } };
  const email = gdprPayload?.customer?.email;
  logger.info({ shop, email }, "Customer data request (GDPR) — no customer PII stored, acknowledging");
  // GDPR compliance: acknowledge receipt. Add data export logic here if you
  // store customer PII (names, emails, addresses, order history, etc.).
});

// ── Built-in: GDPR — Customer redact ──
// ShopForge does NOT store customer PII. This handler acknowledges the webhook.
// If you add customer data storage, you MUST delete it here per GDPR requirements.
webhookRegistry.on("CUSTOMERS_REDACT", async (shop, payload) => {
  const gdprPayload = payload as { customer?: { email?: string } };
  const email = gdprPayload?.customer?.email;
  logger.info({ shop, email }, "Customer redact request (GDPR) — no customer PII stored, acknowledging");
  // GDPR compliance: acknowledge receipt. Add PII deletion logic here if you
  // store customer data.
});

// ── Built-in: GDPR — Shop redact (hard delete, legal requirement) ──
// NOTE: Most related tables now have FK CASCADE to Shop, so deleting the Shop
// automatically cascades to: Order, ShopFunction, WebhookConfig (all via onDelete: Cascade).
// Only Session lacks a FK to Shop (by design — see Session model comment).
webhookRegistry.on("SHOP_REDACT", async (shop) => {
  logger.info({ shop }, "Shop redact request, hard-deleting all data (GDPR)");
  await prisma.$transaction(async (tx) => {
    // Session has no FK to Shop (OAuth stores sessions before Shop exists)
    await tx.session.deleteMany({ where: { shop } });
    // Shop delete cascades to all related tables via FK constraints
    await tx.shop.deleteMany({ where: { shopifyDomain: shop } });
  });
  logger.info({ shop }, "Shop redact completed");
});
