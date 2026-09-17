/**
 * File: services/shopify/metafields.ts
 * Author: yuntongsoft
 * Date: 2026/08/18
 * Purpose: Metafield CRUD — generic owner-scoped and shop-specific helpers.
 */

interface MetafieldResponse {
  [key: string]: {
    metafields: {
      edges: Array<{ node: { id: string; key: string; value: string; type: string; namespace: string } }>;
    };
  } | undefined;
}

interface ShopMetafieldResponse {
  shop?: { metafield: { value: string } | null };
}

interface ShopIdResponse {
  shop?: { id: string };
}

export function createMetafieldsModule(graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>) {
  async function getMetafields(
    ownerType: "SHOP" | "PRODUCT" | "ORDER" | "CUSTOMER",
    namespace: string,
    ownerId?: string
  ): Promise<Array<{ id: string; key: string; value: string; type: string; namespace: string }>> {
    // SECURITY: Whitelist ownerType to prevent GraphQL injection via dynamic field name
    const ALLOWED_OWNER_TYPES = ["shop", "product", "order", "customer"] as const;
    const normalizedOwner = ownerType.toLowerCase();
    if (!ALLOWED_OWNER_TYPES.includes(normalizedOwner as typeof ALLOWED_OWNER_TYPES[number])) {
      throw new Error(`Invalid ownerType: ${ownerType}. Allowed: ${ALLOWED_OWNER_TYPES.join(", ")}`);
    }
    // Use GraphQL variables to prevent injection — never interpolate user input into query strings
    const data = await graphql<MetafieldResponse>(`
      query GetMetafields($id: ID, $namespace: String!) {
        ${normalizedOwner}${ownerId ? "(id: $id)" : ""} {
          metafields(namespace: $namespace, first: 50) {
            edges {
              node { id key value type namespace }
            }
          }
        }
      }
    `, { ...(ownerId ? { id: ownerId } : {}), namespace });

    const key = Object.keys(data)[0];
    return (data[key]?.metafields?.edges || []).map((e) => e.node);
  }

  async function setMetafield(
    ownerId: string,
    namespace: string,
    key: string,
    value: string,
    type = "SINGLE_LINE_TEXT_FIELD"
  ): Promise<void> {
    await graphql(`
      mutation SetMetafield($input: MetafieldsSetInput!) {
        metafieldsSet(metafields: [$input]) {
          metafields { id key value }
          userErrors { field message }
        }
      }
    `, {
      input: { ownerId, namespace, key, value, type },
    });
  }

  async function getShopMetafield(namespace: string, key: string): Promise<string | null> {
    const data = await graphql<ShopMetafieldResponse>(`
      query GetShopMetafield($namespace: String!, $key: String!) {
        shop { metafield(namespace: $namespace, key: $key) { value } }
      }
    `, { namespace, key });
    return data.shop?.metafield?.value || null;
  }

  async function setShopMetafield(namespace: string, key: string, value: string, type = "SINGLE_LINE_TEXT_FIELD"): Promise<void> {
    const shopData = await graphql<ShopIdResponse>(`{ shop { id } }`);
    const shopId = shopData.shop?.id;
    if (!shopId) throw new Error("Could not get shop ID");

    await graphql(`
      mutation SetMetafield($input: MetafieldsSetInput!) {
        metafieldsSet(metafields: [$input]) {
          metafields { id }
          userErrors { field message }
        }
      }
    `, { input: { ownerId: shopId, namespace, key, value, type } });
  }

  return { getMetafields, setMetafield, getShopMetafield, setShopMetafield };
}
