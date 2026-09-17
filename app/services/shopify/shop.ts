/**
 * File: services/shopify/shop.ts
 * Author: yuntongsoft
 * Date: 2026/08/20
 * Purpose: Shop info query — name, plan, currency, etc.
 */
import type { ShopifyShopInfo } from "./types";

interface ShopInfoResponse {
  shop: {
    name: string;
    primaryDomain: { host: string } | null;
    myshopifyDomain: string;
    plan: { displayName: string } | null;
    currencyCode: string;
  };
}

export function createShopModule(graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>) {
  async function getShopInfo(): Promise<ShopifyShopInfo> {
    const data = await graphql<ShopInfoResponse>(`
      query GetShopInfo {
        shop {
          name primaryDomain { host }
          myshopifyDomain plan { displayName }
          currencyCode
        }
      }
    `);

    const s = data.shop;
    return {
      name: s.name,
      email: "", // email is protected customer data
      domain: s.primaryDomain?.host || "",
      myshopifyDomain: s.myshopifyDomain,
      plan: s.plan?.displayName || "Unknown",
      currency: s.currencyCode,
      timezone: "UTC", // timezone field removed from Shop type
    };
  }

  return { getShopInfo };
}
