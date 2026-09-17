/**
 * File: services/shopify/orders.ts
 * Author: yuntongsoft
 * Date: 2026/08/11
 * Purpose: Order queries — list, recent, stats with revenue aggregation.
 */
import type { ShopifyOrder, PaginatedResult, OrderQueryOptions, GraphQLOrderNode } from "./types";

/** Flatten a GraphQL order node into a clean ShopifyOrder object */
function flattenOrder(node: GraphQLOrderNode): ShopifyOrder {
  return {
    id: node.id,
    name: node.name,
    email: "", // email is protected customer data
    totalPrice: node.totalPriceSet?.shopMoney?.amount || "0",
    currency: node.totalPriceSet?.shopMoney?.currencyCode || "USD",
    financialStatus: node.displayFinancialStatus || "",
    fulfillmentStatus: node.displayFulfillmentStatus || "",
    createdAt: node.createdAt,
    lineItems: [], // Line items not fetched for stats
  };
}

interface OrderResponse {
  orders?: {
    edges: Array<{ node: GraphQLOrderNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export function createOrdersModule(graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>) {
  async function getOrders(options: OrderQueryOptions = {}): Promise<PaginatedResult<ShopifyOrder>> {
    const { first = 20, after, query, days } = options;
    let fullQuery = query || "";

    if (days) {
      const since = new Date();
      since.setDate(since.getDate() - days);
      const dateStr = since.toISOString().split("T")[0];
      fullQuery = fullQuery ? `${fullQuery} created_at:>=${dateStr}` : `created_at:>=${dateStr}`;
    }

    const data = await graphql<OrderResponse>(`
      query GetOrders($first: Int!${after ? ", $after: String" : ""}${fullQuery ? ", $query: String" : ""}) {
        orders(first: $first${after ? ", after: $after" : ""}${fullQuery ? ", query: $query" : ""}) {
          edges {
            node {
              id name
              totalPriceSet { shopMoney { amount currencyCode } }
              displayFinancialStatus displayFulfillmentStatus createdAt
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { first, ...(after ? { after } : {}), ...(fullQuery ? { query: fullQuery } : {}) });

    const edges = data.orders?.edges || [];
    return {
      items: edges.map((edge) => flattenOrder(edge.node)),
      hasNextPage: data.orders?.pageInfo?.hasNextPage || false,
      endCursor: data.orders?.pageInfo?.endCursor ?? undefined,
    };
  }

  async function getRecentOrders(days = 7): Promise<ShopifyOrder[]> {
    const result = await getOrders({ first: 50, days });
    return result.items;
  }

  /**
   * Aggregate order statistics over a time window.
   * Uses integer-cent accumulation to avoid floating-point precision loss.
   * Safety limit: max 10 pages (2500 orders) to prevent runaway queries.
   */
  async function getOrderStats(days = 30): Promise<{ totalOrders: number; totalRevenue: number }> {
    let totalOrders = 0;
    let totalCents = 0; // Accumulate in integer cents to avoid float precision loss
    let cursor: string | undefined;
    let hasMore = true;
    const MAX_PAGES = 10; // Safety valve: cap at 2500 orders
    let pages = 0;

    while (hasMore && pages < MAX_PAGES) {
      const result = await getOrders({ first: 250, days, after: cursor });
      totalOrders += result.items.length;
      for (const order of result.items) {
        // Parse price string to integer cents (e.g. "12.50" → 1250)
        totalCents += Math.round(parseFloat(order.totalPrice) * 100);
      }
      cursor = result.endCursor;
      hasMore = result.hasNextPage;
      pages++;
    }

    return { totalOrders, totalRevenue: totalCents / 100 };
  }

  return { getOrders, getRecentOrders, getOrderStats };
}
