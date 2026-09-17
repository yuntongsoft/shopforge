/**
 * File: services/shopify/types.ts
 * Author: yuntongsoft
 * Date: 2026/08/03
 * Purpose: Shared types for the Shopify Admin API module.
 *
 * All interfaces returned by the shopify-admin API live here so each
 * sub-module can import them without circular dependencies.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Public result types (used by route handlers)
// ─────────────────────────────────────────────────────────────────────────────

export interface ShopifyProduct {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string;
  productType: string;
  image?: string;
  variants: Array<{
    id: string;
    title: string;
    price: string;
    compareAtPrice?: string;
    sku: string;
    inventoryQuantity: number;
  }>;
}

export interface ShopifyCollection {
  id: string;
  title: string;
  handle: string;
  productsCount: number;
}

export interface ShopifyOrder {
  id: string;
  name: string;
  email: string;
  totalPrice: string;
  currency: string;
  financialStatus: string;
  fulfillmentStatus: string;
  createdAt: string;
  lineItems: Array<{
    id: string;
    title: string;
    quantity: number;
    price: string;
  }>;
}

export interface ShopifyShopInfo {
  name: string;
  email: string;
  domain: string;
  myshopifyDomain: string;
  plan: string;
  currency: string;
  timezone: string;
}

export interface PaginatedResult<T> {
  items: T[];
  hasNextPage: boolean;
  endCursor?: string;
}

export interface ProductQueryOptions {
  first?: number;
  after?: string;
  query?: string;
}

export interface OrderQueryOptions {
  first?: number;
  after?: string;
  query?: string;
  days?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal GraphQL node shapes (used by flatten helpers)
// ─────────────────────────────────────────────────────────────────────────────

export interface GraphQLProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor: string;
  productType: string;
  images?: { edges: Array<{ node: { url: string } }> };
  variants?: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        price: string;
        compareAtPrice: string | null;
        sku: string;
        inventoryQuantity: number;
      };
    }>;
  };
}

export interface GraphQLOrderNode {
  id: string;
  name: string;
  totalPriceSet?: { shopMoney: { amount: string; currencyCode: string } };
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  createdAt: string;
}
