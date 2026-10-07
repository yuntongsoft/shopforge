/**
 * File: routes/api.webhooks.tsx
 * Author: yuntongsoft
 * Date: 2026/10/07
 * Purpose: Webhook management API — CRUD for outbound webhook configurations.
 *          Merchants use these endpoints to register URLs that receive real-time
 *          notifications about app events (rule changes, quota warnings, etc.).
 *
 * Routes:
 *   GET    /api/webhooks?shop_id=xxx     — List all configs for a shop
 *   POST   /api/webhooks                 — Create a new webhook config
 *   PATCH  /api/webhooks?id=xxx          — Update a config (url, events, isActive)
 *   DELETE /api/webhooks?id=xxx          — Delete a config
 *
 * Security: All endpoints require Shopify admin authentication.
 *
 * Dependencies: shopify.server (authenticate), prisma, webhook-outbound
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "~/shopify.server";
import prisma from "~/db.server";
import { generateWebhookSecret } from "~/services/webhook-outbound";
import { createLogger } from "~/utils/logger";
import { getErrorMessage } from "~/utils/errors";

const logger = createLogger({ module: "api.webhooks" });

// ─────────────────────────────────────────────────────────────────────────────
// GET — List webhook configs for a shop
// ─────────────────────────────────────────────────────────────────────────────

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Resolve shop ID from session domain
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const configs = await prisma.webhookConfig.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      url: true,
      events: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      // NOTE: secret is intentionally excluded from the response
    },
  });

  // Parse events JSON string to array for the response
  const parsed = configs.map((c) => ({
    ...c,
    events: safeParseEvents(c.events),
  }));

  return json({ configs: parsed });
};

// ─────────────────────────────────────────────────────────────────────────────
// POST / PATCH / DELETE — Manage webhook configs
// ─────────────────────────────────────────────────────────────────────────────

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopDomain = session.shop;

  // Resolve shop ID
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true },
  });

  if (!shop) {
    return json({ error: "Shop not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // ── DELETE ──
  if (method === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) {
      return json({ error: "Missing config id" }, { status: 400 });
    }

    try {
      await prisma.webhookConfig.deleteMany({
        where: { id, shopId: shop.id },
      });
      logger.info({ shopId: shop.id, configId: id }, "Webhook config deleted");
      return json({ success: true });
    } catch (error) {
      logger.error({ error: getErrorMessage(error), configId: id }, "Failed to delete webhook config");
      return json({ error: "Failed to delete webhook config" }, { status: 500 });
    }
  }

  // ── PATCH (update) ──
  if (method === "PATCH") {
    const id = url.searchParams.get("id");
    if (!id) {
      return json({ error: "Missing config id" }, { status: 400 });
    }

    const body = await request.json();
    const { url: webhookUrl, events, isActive } = body as {
      url?: string;
      events?: string[];
      isActive?: boolean;
    };

    const updateData: Record<string, unknown> = {};
    if (webhookUrl !== undefined) updateData.url = webhookUrl;
    if (events !== undefined) updateData.events = JSON.stringify(events);
    if (isActive !== undefined) updateData.isActive = isActive;

    try {
      const config = await prisma.webhookConfig.updateMany({
        where: { id, shopId: shop.id },
        data: updateData,
      });

      if (config.count === 0) {
        return json({ error: "Webhook config not found" }, { status: 404 });
      }

      logger.info({ shopId: shop.id, configId: id }, "Webhook config updated");
      return json({ success: true });
    } catch (error) {
      logger.error({ error: getErrorMessage(error), configId: id }, "Failed to update webhook config");
      return json({ error: "Failed to update webhook config" }, { status: 500 });
    }
  }

  // ── POST (create) ──
  if (method === "POST") {
    const body = await request.json();
    const { url: webhookUrl, events } = body as {
      url: string;
      events: string[];
    };

    if (!webhookUrl || !events || !Array.isArray(events)) {
      return json({ error: "Missing required fields: url, events" }, { status: 400 });
    }

    // Basic URL validation
    try {
      new URL(webhookUrl);
    } catch {
      return json({ error: "Invalid URL format" }, { status: 400 });
    }

    try {
      const secret = generateWebhookSecret();
      const config = await prisma.webhookConfig.create({
        data: {
          shopId: shop.id,
          url: webhookUrl,
          secret,
          events: JSON.stringify(events),
          isActive: true,
        },
      });

      logger.info({ shopId: shop.id, configId: config.id, url: webhookUrl }, "Webhook config created");

      // Return the secret only on creation — it's not shown again
      return json({
        config: {
          id: config.id,
          url: config.url,
          events,
          isActive: config.isActive,
          createdAt: config.createdAt,
        },
        // Secret is returned ONLY at creation time so the merchant can configure
        // their receiving endpoint. Subsequent GET requests do NOT include it.
        secret,
      }, { status: 201 });
    } catch (error) {
      logger.error({ error: getErrorMessage(error) }, "Failed to create webhook config");
      return json({ error: "Failed to create webhook config" }, { status: 500 });
    }
  }

  return json({ error: "Method not allowed" }, { status: 405 });
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely parse the events JSON string from the database.
 * Returns an empty array if parsing fails (defensive — should never happen).
 */
function safeParseEvents(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
