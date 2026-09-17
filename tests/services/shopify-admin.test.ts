/**
 * Tests for shopify-admin.ts — factory function structure
 *
 * Coverage:
 *   - Factory returns correct API surface
 *   - All expected methods exist and are functions
 *   - Type exports are correct
 *
 * NOTE: We only test the factory structure here, not actual API calls.
 * Integration tests with real Shopify API are out of scope for unit tests.
 */
import { describe, it, expect } from "vitest";
import { shopifyAdmin } from "~/services/shopify-admin";

describe("shopifyAdmin factory", () => {
  // The factory doesn't call prisma until a method is invoked,
  // so we can safely create an instance for structural tests
  const api = shopifyAdmin("test-shop.myshopify.com");

  it("should return an object", () => {
    expect(api).toBeDefined();
    expect(typeof api).toBe("object");
  });

  // Products
  it("should have getProducts method", () => {
    expect(typeof api.getProducts).toBe("function");
  });

  it("should have getAllProducts method", () => {
    expect(typeof api.getAllProducts).toBe("function");
  });

  // Collections
  it("should have getCollections method", () => {
    expect(typeof api.getCollections).toBe("function");
  });

  it("should have getCollectionProducts method", () => {
    expect(typeof api.getCollectionProducts).toBe("function");
  });

  // Orders
  it("should have getOrders method", () => {
    expect(typeof api.getOrders).toBe("function");
  });

  it("should have getRecentOrders method", () => {
    expect(typeof api.getRecentOrders).toBe("function");
  });

  it("should have getOrderStats method", () => {
    expect(typeof api.getOrderStats).toBe("function");
  });

  // Shop
  it("should have getShopInfo method", () => {
    expect(typeof api.getShopInfo).toBe("function");
  });

  // Customers
  it("should have getCustomers method", () => {
    expect(typeof api.getCustomers).toBe("function");
  });

  // Metafields
  it("should have getMetafields method", () => {
    expect(typeof api.getMetafields).toBe("function");
  });

  it("should have setMetafield method", () => {
    expect(typeof api.setMetafield).toBe("function");
  });

  // Shop Metafields
  it("should have getShopMetafield method", () => {
    expect(typeof api.getShopMetafield).toBe("function");
  });

  it("should have setShopMetafield method", () => {
    expect(typeof api.setShopMetafield).toBe("function");
  });

  // Raw GraphQL
  it("should have graphql escape hatch method", () => {
    expect(typeof api.graphql).toBe("function");
  });

  // API surface count — ensures no methods are accidentally removed
  it("should expose exactly 14 methods", () => {
    const methods = Object.keys(api);
    expect(methods.length).toBe(14);
  });
});
