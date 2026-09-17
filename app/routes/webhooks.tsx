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
 * Dependencies: shopify.server, webhook-registry
 */
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import { webhookRegistry } from "~/services/webhook-registry";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "webhooks" });

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  logger.info({ shop, topic }, "Webhook received");
  await webhookRegistry.dispatch(topic, shop, payload);

  return new Response();
};

