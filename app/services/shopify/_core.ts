/**
 * File: services/shopify/_core.ts
 * Author: yuntongsoft
 * Date: 2026/08/05
 * Purpose: Shared infrastructure for the Shopify Admin API module.
 *
 * Provides token retrieval (with per-request caching) and a typed GraphQL
 * execution function with retry, 401 handling, and error normalization.
 *
 * This is imported by every sub-module (products, orders, etc.) and by
 * the facade (index.ts).
 */
import prisma from "~/db.server";
import { decrypt } from "~/utils/encryption";
import { createLogger } from "~/utils/logger";
import { withRetry } from "~/utils/retry";
import { SHOPIFY_API_VERSION } from "~/utils/shopify-config";
import { shopifyRateLimiter } from "~/services/shopify-rate-limiter";

const logger = createLogger({ module: "shopify-admin" });
const API_VERSION = SHOPIFY_API_VERSION;

/**
 * Create the core API client bound to a shop domain.
 * Returns getToken() and graphql() for use by sub-modules.
 */
export function createCore(shopDomain: string) {
  let cachedToken: string | null = null;

  /**
   * Get the decrypted access token (cached per request)
   */
  async function getToken(): Promise<string> {
    if (cachedToken) return cachedToken;

    const shop = await prisma.shop.findUnique({
      where: { shopifyDomain: shopDomain },
      select: { shopifyToken: true },
    });

    if (!shop?.shopifyToken) {
      throw new Error(`No token found for shop: ${shopDomain}. Please reinstall the app.`);
    }

    cachedToken = decrypt(shop.shopifyToken);
    return cachedToken;
  }

  /**
   * Execute a raw GraphQL query (escape hatch for custom queries)
   * Integrates adaptive rate limiting: waits before request if bucket is near capacity,
   * tracks state from response headers, and handles 429 with Retry-After.
   */
  async function graphql<T>(
    query: string,
    variables?: Record<string, unknown>
  ): Promise<T> {
    const accessToken = await getToken();
    const url = `https://${shopDomain}/admin/api/${API_VERSION}/graphql.json`;

    return withRetry(
      async () => {
        // Adaptive rate limit: wait if bucket usage is high
        await shopifyRateLimiter.acquire(shopDomain);

        try {
          const response = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": accessToken,
            },
            body: JSON.stringify({ query, variables }),
          });

          // Track rate limit state from response headers
          shopifyRateLimiter.track(shopDomain, response);

          if (response.status === 401) {
            throw new Error("Shopify access token expired or revoked. Please reinstall the app.");
          }

          // 429 Too Many Requests: rate limit exceeded, let withRetry handle retry
          if (response.status === 429) {
            shopifyRateLimiter.handle429(shopDomain, response);
            const retryAfter = response.headers.get("Retry-After") || "2";
            throw new Error(`Shopify API rate limit exceeded. Retry after ${retryAfter}s`);
          }

          if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`Shopify API error ${response.status}: ${body.slice(0, 300)}`);
          }

          const json = await response.json();

          if (json.errors?.length) {
            const messages = json.errors.map((e: { message: string }) => e.message).join(", ");
            throw new Error(`GraphQL error: ${messages}`);
          }

          // Circuit breaker: successful response resets consecutive 429 counter
          shopifyRateLimiter.recordSuccess(shopDomain);

          return json.data as T;
        } finally {
          shopifyRateLimiter.release(shopDomain);
        }
      },
      { maxRetries: 2, label: `shopifyAdmin(${shopDomain})` }
    );
  }

  return { getToken, graphql };
}
