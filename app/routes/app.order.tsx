/**
 * File: routes/app.order.tsx
 * Author: yuntongsoft
 * Date: 2026/09/08
 * Purpose: [DEMO] Order CRUD page — route wrapper with server-side logic
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
import prisma from "~/db.server";
import { rateLimit, RATE_LIMIT_PRESETS } from "~/utils/rate-limiter";
import { generateCsrfToken, validateCsrfRequest } from "~/utils/csrf";
import { createLogger } from "~/utils/logger";
import { SHOPIFY_API_VERSION } from "~/utils/shopify-config";

// Re-export the demo component (pure React, no server deps)
export { default } from "~/demo/routes/order";

const logger = createLogger({ module: "order" });

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — Fetch orders from Shopify Admin GraphQL API
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return authResponse(auth);
  const shop = auth.shop;
  const accessToken = auth.accessToken;

  const url = new URL(request.url);
  const cursorParam = url.searchParams.get("cursor");
  const PAGE_SIZE = 50;

  // SECURITY: Validate cursor format — Shopify cursors are base64-encoded strings.
  // Reject any non-base64 input to prevent GraphQL injection.
  if (cursorParam && !/^[A-Za-z0-9+/=_-]+$/.test(cursorParam)) {
    return json({ error: "Invalid cursor parameter" }, { status: 400 });
  }

  // Use GraphQL variables for cursor — never interpolate user input into query strings
  const response = await fetch(
    `https://${shop.shopifyDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({
        query: `
          query GetOrders($first: Int!, $after: String) {
            orders(first: $first, after: $after, sortKey: CREATED_AT, reverse: true) {
              edges {
                cursor
                node {
                  id
                  name
                  displayFinancialStatus
                  displayFulfillmentStatus
                  totalPriceSet {
                    shopMoney { amount currencyCode }
                  }
                  customer {
                    displayName
                  }
                  createdAt
                }
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `,
        variables: {
          first: PAGE_SIZE,
          ...(cursorParam ? { after: cursorParam } : {}),
        },
      }),
    },
  );

  const data = await response.json();
  const edges: Array<{
    node: {
      id: string;
      name: string;
      displayFinancialStatus: string | null;
      displayFulfillmentStatus: string | null;
      totalPriceSet: { shopMoney: { amount: string; currencyCode: string } } | null;
      customer: { displayName: string } | null;
      createdAt: string;
    };
  }> = data?.data?.orders?.edges ?? [];
  const pageInfo = data?.data?.orders?.pageInfo ?? { hasNextPage: false, endCursor: null };

  // Map Shopify statuses to i18n keys (orders.statusOptions.*)
  const mapFinancialStatus = (s: string) => {
    switch (s) {
      case "PENDING": case "AUTHORIZED": case "PARTIALLY_PAID": return "pending";
      case "PAID": return "paid";
      case "PARTIALLY_REFUNDED": case "PENDING_REFUND": return "refunding";
      case "REFUNDED": return "refunded";
      case "VOIDED": return "cancelled";
      default: return "pending";
    }
  };
  const mapFulfillmentStatus = (s: string) => {
    switch (s) {
      case "UNFULFILLED": case "OPEN": case "ON_HOLD": case "PENDING_FULFILLMENT": return "unfulfilled";
      case "IN_PROGRESS": case "SCHEDULED": case "PARTIALLY_FULFILLED": return "processing";
      case "FULFILLED": return "fulfilled";
      case "RESTOCKED": return "cancelled";
      default: return "unfulfilled";
    }
  };

  const orders = edges.map((edge) => ({
    id: edge.node.id,
    orderNumber: edge.node.name,
    customer: edge.node.customer?.displayName || "\u2014",
    amount: parseFloat(edge.node.totalPriceSet?.shopMoney?.amount || "0"),
    status: `${mapFinancialStatus(edge.node.displayFinancialStatus || "")}/${mapFulfillmentStatus(edge.node.displayFulfillmentStatus || "")}`,
    note: "",
  }));

  return json({
    orders,
    nextCursor: pageInfo.hasNextPage ? pageInfo.endCursor : null,
    shopPlan: shop.plan,
    csrfToken: generateCsrfToken(),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTION — Handle create / update / delete
// ─────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return authResponse(auth);
  const shop = auth.shop;

  const ip = request.headers.get("x-forwarded-for") || "unknown";
  const blocked = await rateLimit(`order:${shop.id}:${ip}`, RATE_LIMIT_PRESETS.write);
  if (blocked) {
    return json(
      { error: `Too many requests. Retry in ${blocked.retryAfter}s` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(blocked.retryAfter / 1000)) } }
    );
  }

  let formData: FormData;
  try {
    formData = await validateCsrfRequest(request);
  } catch {
    return json({ error: "Invalid or expired CSRF token. Please refresh the page." }, { status: 403 });
  }
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "create": {
      // Validate amount: must be a non-negative number within reasonable range
      const amountCreate = Number(formData.get("amount") || 0);
      if (isNaN(amountCreate) || amountCreate < 0 || amountCreate > 99_999_999) {
        return json({ error: "Amount must be a number between 0 and 99,999,999" }, { status: 400 });
      }
      // Validate status against allowed enum values
      const VALID_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled", "refunded"] as const;
      const statusCreate = String(formData.get("status") || "pending");
      if (!VALID_STATUSES.includes(statusCreate as typeof VALID_STATUSES[number])) {
        return json({ error: `Invalid status. Allowed: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
      }

      const item = await prisma.order.create({
        data: {
          shopId: shop.id,
          orderNumber: String(formData.get("orderNumber") || ""),
          customer: String(formData.get("customer") || ""),
          amount: amountCreate,
          status: statusCreate,
          note: String(formData.get("note") || ""),
        },
      });
      logger.info({ shopId: shop.id, id: item.id }, "Order created");
      return json({ success: true, item });
    }

    case "update": {
      const id = String(formData.get("id"));
      const existing = await prisma.order.findFirst({ where: { id, shopId: shop.id } });
      if (!existing) return json({ error: "Not found" }, { status: 404 });

      // Validate amount: must be a non-negative number within reasonable range
      const amountUpdate = Number(formData.get("amount") || 0);
      if (isNaN(amountUpdate) || amountUpdate < 0 || amountUpdate > 99_999_999) {
        return json({ error: "Amount must be a number between 0 and 99,999,999" }, { status: 400 });
      }
      // Validate status against allowed enum values
      const VALID_STATUSES_UPDATE = ["pending", "processing", "shipped", "delivered", "cancelled", "refunded"] as const;
      const statusUpdate = String(formData.get("status") || "pending");
      if (!VALID_STATUSES_UPDATE.includes(statusUpdate as typeof VALID_STATUSES_UPDATE[number])) {
        return json({ error: `Invalid status. Allowed: ${VALID_STATUSES_UPDATE.join(", ")}` }, { status: 400 });
      }

      const data: Record<string, unknown> = {};
      data.orderNumber = String(formData.get("orderNumber") || "");
      data.customer = String(formData.get("customer") || "");
      data.amount = amountUpdate;
      data.status = statusUpdate;
      data.note = String(formData.get("note") || "");

      const updated = await prisma.order.update({ where: { id }, data });
      logger.info({ shopId: shop.id, id: updated.id }, "Order updated");
      return json({ success: true, item: updated });
    }

    case "delete": {
      const id = String(formData.get("id"));
      const existing = await prisma.order.findFirst({ where: { id, shopId: shop.id } });
      if (!existing) return json({ error: "Not found" }, { status: 404 });

      await prisma.order.delete({ where: { id } });
      logger.info({ shopId: shop.id, id }, "Order deleted");
      return json({ success: true });
    }

    default:
      return json({ error: "Unknown intent" }, { status: 400 });
  }
};
