/**
 * File: services/shopify-admin.ts
 * Author: yuntongsoft
 * Date: 2026/09/10
 * Purpose: Backward-compatible re-export.
 *
 * The Shopify Admin API has been split into domain modules under
 * services/shopify/ (products, orders, collections, customers, metafields, shop).
 *
 * This file preserves the original import path so existing code continues
 * to work without changes:
 *   import { shopifyAdmin } from "~/services/shopify-admin";
 *
 * New code should prefer:
 *   import { shopifyAdmin } from "~/services/shopify";
 */
export { shopifyAdmin } from "~/services/shopify";
export type {
  ShopifyProduct,
  ShopifyCollection,
  ShopifyOrder,
  ShopifyShopInfo,
  PaginatedResult,
  ProductQueryOptions,
  OrderQueryOptions,
} from "~/services/shopify";
