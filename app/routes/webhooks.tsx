/**
 * File: routes/webhooks.tsx
 * Author: yuntongsoft
 * Date: 2026/09/02
 * Purpose: Shopify Webhook forwarder — delegates all handling to webhook-registry.
 *
 * Developers NEVER edit this file. Instead, register handlers:
 *   import { webhookRegistry } from "~/services/webhook-registry";
 *   webhookRegistry.on("ORDERS_CREATE", async (shop, payload) => { ... });
 *
 * The webhookId (X-Shopify-Webhook-Id) is extracted from request headers and passed
 * through to the registry for idempotent dedup — Shopify retries unacknowledged
 * events with the same ID, and the queue uses it for the unique constraint.
 *
 * Dependencies: shopify.server, webhook-registry
 */
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { webhookRegistry } from "~/services/webhook-registry";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "webhooks" });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  // Extract Shopify webhook ID for idempotent dedup in the async queue.
  // This header is set by Shopify on every webhook delivery.
  const webhookId = request.headers.get("X-Shopify-Webhook-Id") || undefined;

  logger.info({ shop, topic, webhookId }, "Webhook received");
  await webhookRegistry.dispatch(topic, shop, payload, webhookId);

  return new Response();
};

