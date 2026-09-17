/**
 * File: services/shopify/index.ts
 * Author: yuntongsoft
 * Date: 2026/08/22
 * Purpose: Facade that aggregates all Shopify Admin API sub-modules.
 *
 * This is the single entry point for the Shopify Admin API.
 * It creates the shared core (token + graphql) and passes it to each
 * domain module, then returns a unified API surface.
 *
 * Usage:
 *   import { shopifyAdmin } from "~/services/shopify";
 *   const api = shopifyAdmin("example.myshopify.com");
 *   const products = await api.getProducts({ first: 20 });
 */
import { createCore } from "./_core";
import { createProductsModule } from "./products";
import { createOrdersModule } from "./orders";
import { createCollectionsModule } from "./collections";
import { createCustomersModule } from "./customers";
import { createMetafieldsModule } from "./metafields";
import { createShopModule } from "./shop";

// Re-export all types so consumers can import from one place
export type {
  ShopifyProduct,
  ShopifyCollection,
  ShopifyOrder,
  ShopifyShopInfo,
  PaginatedResult,
  ProductQueryOptions,
  OrderQueryOptions,
} from "./types";

/**
 * Create a Shopify Admin API client bound to a shop domain.
 *
 * Usage:
 *   const api = shopifyAdmin("example.myshopify.com");
 *   const products = await api.getProducts();
 */
export function shopifyAdmin(shopDomain: string) {
  const { graphql } = createCore(shopDomain);

  const products = createProductsModule(graphql);
  const orders = createOrdersModule(graphql);
  const collections = createCollectionsModule(graphql);
  const customers = createCustomersModule(graphql);
  const metafields = createMetafieldsModule(graphql);
  const shop = createShopModule(graphql);

  return {
    // Raw GraphQL escape hatch
    graphql,

    // Products
    getProducts: products.getProducts,
    getAllProducts: products.getAllProducts,

    // Collections
    getCollections: collections.getCollections,
    getCollectionProducts: collections.getCollectionProducts,

    // Orders
    getOrders: orders.getOrders,
    getRecentOrders: orders.getRecentOrders,
    getOrderStats: orders.getOrderStats,

    // Shop
    getShopInfo: shop.getShopInfo,

    // Customers
    getCustomers: customers.getCustomers,

    // Shop Metafields (convenience wrappers)
    getShopMetafield: metafields.getShopMetafield,
    setShopMetafield: metafields.setShopMetafield,

    // Metafields (generic)
    getMetafields: metafields.getMetafields,
    setMetafield: metafields.setMetafield,
  };
}
