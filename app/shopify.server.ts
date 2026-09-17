/**
 * File: shopify.server.ts
 * Author: yuntongsoft
 * Date: 2026/08/22
 * Purpose: Shopify SDK initialization — OAuth, session storage, auto-webhook config
 *
 * ============================================================================
 * AUTHENTICATION — WHICH ONE TO USE?
 * ============================================================================
 *
 * This file exports authenticate.admin(request) — the Shopify SDK's built-in auth.
 * Use it when you need to call Shopify Admin API (products, orders, etc.).
 *
 * For lightweight page auth (just shop ID + access token), see authenticatePage()
 * in ~/utils/shopify-auth.ts.
 *
 * Quick reference:
 *   - Webhook handlers → authenticate.admin() from THIS FILE
 *   - API routes calling Shopify → authenticate.admin() from THIS FILE
 *   - Page loaders/actions with custom DB queries → authenticatePage() from shopify-auth.ts
 *
 * Webhook subscriptions are auto-generated from webhook-registry.
 * Developers register handlers via webhookRegistry.on() — no need to touch this file.
 *
 * Dependencies: @shopify/shopify-app-remix, prisma, encryption, logger, webhook-registry
 * Used by: All routes that need Shopify authentication
 *
 * Usage:
 *   import shopify, { authenticate } from "~/shopify.server";
 *   const { admin } = await authenticate.admin(request);
 */
import prisma from "./db.server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import { shopifyApp, DeliveryMethod } from "@shopify/shopify-app-remix/server";
import { SHOPIFY_API_VERSION_ENUM } from "~/utils/shopify-config";
import { encrypt } from "~/utils/encryption";
import { createLogger } from "~/utils/logger";
import { registerShop } from "~/utils/shop-registration";
// Import webhook-registry for side effects (registers built-in handlers)
// and to auto-generate webhook subscriptions below.
import { webhookRegistry } from "~/services/webhook-registry";

const logger = createLogger({ module: "shopify.server" });

/**
 * OAuth scopes — must match shopify.app.toml [access_scopes]
 * Adjust these to match your app's API needs.
 */
export const APP_SCOPES = [
  "read_products",
  "write_products",
  "read_orders",
  "read_discounts",
  "write_discounts",
];

/**
 * Auto-generate webhook subscriptions from the registry.
 * Every topic registered via webhookRegistry.on() gets a subscription automatically.
 * Developers never need to manually declare webhooks here.
 *
 * Topics use SCREAMING_SNAKE_CASE (e.g. "APP_UNINSTALLED") which the SDK passes
 * directly as GraphQL enum values — this is the correct format for the Admin API.
 * The shopify.app.toml uses lowercase "app/uninstalled" but the SDK normalizes
 * both to the same internal key via topicForStorage().
 */
function buildWebhookConfig() {
  const topics = webhookRegistry.getRegisteredTopics();
  const config: Record<string, { deliveryMethod: typeof DeliveryMethod.Http; callbackUrl: string }> = {};

  for (const topic of topics) {
    config[topic] = {
      deliveryMethod: DeliveryMethod.Http,
      callbackUrl: "/webhooks",
    };
  }

  logger.debug({ topics }, `Auto-configured ${topics.length} webhook subscriptions from registry`);
  return config;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fail-fast: required env vars MUST be set before SDK initialization
// ─────────────────────────────────────────────────────────────────────────────
const REQUIRED_SHOPIFY_ENV = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET"] as const;
const missingShopify = REQUIRED_SHOPIFY_ENV.filter((key) => !process.env[key]);
if (missingShopify.length > 0) {
  throw new Error(
    `[shopify.server] Missing required environment variables: ${missingShopify.join(", ")}\n` +
    `Fix: Add them to your .env file. See .env.example for reference.`
  );
}

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY!,
  apiSecretKey: process.env.SHOPIFY_API_SECRET!,
  apiVersion: SHOPIFY_API_VERSION_ENUM,
  scopes: process.env.SHOPIFY_SCOPES?.split(",") ?? APP_SCOPES,
  appUrl: process.env.APP_URL || "http://localhost:3000",
  isEmbeddedApp: true,
  isOnline: false, // Force offline tokens — match traffic-guard pattern
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),

  // Auto-generated from webhook-registry — no manual config needed
  webhooks: buildWebhookConfig(),

  // After OAuth completes, sync the encrypted token to the Shop table
  hooks: {
    afterAuth: async ({ session }) => {
      if (!session.accessToken) {
        logger.warn({ shop: session.shop }, "No access token in session, skipping shop registration");
        return;
      }

      try {
        // Use shared registration logic (same as auth.$.tsx and auth.callback.tsx)
        await registerShop(session.shop, session.accessToken, session.scope || "");
        logger.info({ shop: session.shop }, "Shop registered after auth");
      } catch (error) {
        logger.error({ error, shop: session.shop }, "Failed to register shop after auth");
      }
    },
  },

  future: {
    unstable_newEmbeddedAuthStrategy: true,
  },
});

export default shopify;
export const { authenticate } = shopify;

