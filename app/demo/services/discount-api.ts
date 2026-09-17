/**
 * File: demo/services/discount-api.ts
 * Author: yuntongsoft
 * Date: 2026/09/07
 * Purpose: Shopify Discount API — create, update, delete automatic discounts
 *
 * ============================================================================
 * DEMO CODE — Delete app/demo/ to remove all demo code
 * ============================================================================
 *
 * This is Layer 4 of the Function system: the Shopify API calls that
 * create the actual discount record that triggers the Function at checkout.
 *
 * Data flow:
 *   1. Merchant fills config form (UI)
 *   2. discountApi.createDiscount() → creates automatic discount in Shopify
 *   3. discountSync.syncConfig() → writes config to discount metafield
 *   4. Function reads metafield at checkout → applies discount
 *
 * Dependencies: shopify-admin.ts (infrastructure)
 */
import { shopifyAdmin } from "~/services/shopify-admin";
import { createLogger } from "~/utils/logger";
import { getErrorMessage } from "~/utils/errors";

const logger = createLogger({ module: "discount-api" });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** GraphQL UserError returned by Shopify mutations */
interface GraphQLUserError {
  field: string[] | null;
  message: string;
}

/** GraphQL response for discountAutomaticAppCreate */
interface DiscountCreateResponse {
  discountAutomaticAppCreate: {
    automaticAppDiscount: {
      id: string;
      title: string;
      status: string;
      startsAt: string;
      endsAt: string | null;
      createdAt: string;
    };
    userErrors: GraphQLUserError[];
  };
}

/** GraphQL response for discountAutomaticAppUpdate */
interface DiscountUpdateResponse {
  discountAutomaticAppUpdate: {
    automaticAppDiscount: { id: string; title?: string; status?: string } | null;
    userErrors: GraphQLUserError[];
  };
}

/** A single discount node edge from discountNodes query */
interface DiscountNodeEdge {
  node: {
    id: string;
    title: string;
    status: string;
    startsAt: string;
    endsAt: string | null;
    createdAt: string;
    metafield?: { value: string } | null;
  };
}

/** GraphQL response for discountNodes listing */
interface DiscountListResponse {
  discountNodes: {
    edges: DiscountNodeEdge[];
  };
}

/** A single extension node edge from app extensions query */
interface ExtensionNodeEdge {
  node: {
    id: string;
    handle: string;
    title: string | null;
    extensionApiType: string;
  };
}

/** GraphQL response for app extensions listing */
interface ExtensionListResponse {
  app: {
    installation: {
      app: {
        extensions: {
          edges: ExtensionNodeEdge[];
        };
      };
    };
  };
}

export interface CreateDiscountInput {
  /** Discount title shown to merchants in Shopify Admin */
  title: string;
  /** The deployed Function's GID (e.g. "gid://shopify/Function/xxx") */
  functionId: string;
  /** Namespace for the config metafield (default: "custom") */
  metafieldNamespace?: string;
  /** Key for the config metafield (default: "discount_config") */
  metafieldKey?: string;
  /** JSON-serializable config object passed to the Function */
  config: Record<string, unknown>;
  /** Start date (ISO string). Default: now */
  startsAt?: string;
  /** End date (ISO string). Default: none */
  endsAt?: string;
}

export interface DiscountRecord {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt?: string;
  createdAt: string;
  /** Parsed config from metafield (if available) */
  config?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Discount API client bound to a shop
 */
export function discountApi(shopDomain: string) {
  const api = shopifyAdmin(shopDomain);

  /**
   * Create an automatic discount with a Function reference
   */
  async function createDiscount(input: CreateDiscountInput): Promise<{
    discount?: DiscountRecord;
    error?: string;
  }> {
    const {
      title,
      functionId,
      metafieldNamespace = "custom",
      metafieldKey = "discount_config",
      config,
      startsAt,
      endsAt,
    } = input;

    const mutation = `
      mutation discountAutomaticAppCreate($input: DiscountAutomaticAppInput!) {
        discountAutomaticAppCreate(automaticAppDiscount: $input) {
          automaticAppDiscount {
            id title status startsAt endsAt createdAt
          }
          userErrors { field message }
        }
      }
    `;

    const variables = {
      input: {
        title,
        functionId,
        startsAt: startsAt || new Date().toISOString(),
        endsAt: endsAt || null,
        metafields: [
          {
            namespace: metafieldNamespace,
            key: metafieldKey,
            value: JSON.stringify(config),
            type: "JSON",
          },
        ],
      },
    };

    try {
      const data = await api.graphql<DiscountCreateResponse>(mutation, variables);
      const result = data.discountAutomaticAppCreate;

      if (result.userErrors?.length > 0) {
        const messages = result.userErrors.map((e) => `${e.field}: ${e.message}`).join(", ");
        logger.error({ shopDomain, errors: messages }, "Failed to create discount");
        return { error: messages };
      }

      const discount = result.automaticAppDiscount;
      logger.info({ shopDomain, discountId: discount.id, title }, "Discount created");

      return {
        discount: {
          id: discount.id,
          title: discount.title,
          status: discount.status,
          startsAt: discount.startsAt,
          endsAt: discount.endsAt ?? undefined,
          createdAt: discount.createdAt,
        },
      };
    } catch (error) {
      logger.error({ shopDomain, error: getErrorMessage(error) }, "Failed to create discount");
      return { error: getErrorMessage(error) };
    }
  }

  /**
   * Update an existing discount's config (metafield value)
   */
  async function updateDiscountConfig(
    discountId: string,
    config: Record<string, unknown>,
    metafieldNamespace = "custom",
    metafieldKey = "discount_config"
  ): Promise<{ success: boolean; error?: string }> {
    const mutation = `
      mutation discountAutomaticAppUpdate($id: ID!, $input: DiscountAutomaticAppInput!) {
        discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $input) {
          automaticAppDiscount { id title status }
          userErrors { field message }
        }
      }
    `;

    const variables = {
      id: discountId,
      input: {
        metafields: [
          {
            namespace: metafieldNamespace,
            key: metafieldKey,
            value: JSON.stringify(config),
            type: "JSON",
          },
        ],
      },
    };

    try {
      const data = await api.graphql<DiscountUpdateResponse>(mutation, variables);
      const result = data.discountAutomaticAppUpdate;

      if (result.userErrors?.length > 0) {
        const messages = result.userErrors.map((e) => `${e.field}: ${e.message}`).join(", ");
        return { success: false, error: messages };
      }

      logger.info({ shopDomain, discountId }, "Discount config updated");
      return { success: true };
    } catch (error) {
      logger.error({ shopDomain, error: getErrorMessage(error) }, "Failed to update discount");
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /**
   * List all automatic discounts (includes Function-based discounts).
   * Uses cursor pagination. Safety limit: max 10 pages (500 discounts).
   *
   * NOTE: In API 2025-01+, `metafield` field was removed from DiscountAutomaticApp.
   * We fetch basic discount info from discountNodes, then fetch config metafields
   * separately via the node(id:) query.
   */
  async function listDiscounts(): Promise<DiscountRecord[]> {
    const all: DiscountRecord[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    const MAX_PAGES = 10;
    let pages = 0;

    while (hasMore && pages < MAX_PAGES) {
      // SECURITY: Use GraphQL variables for cursor to prevent injection
      const data = await api.graphql<{
        discountNodes: {
          edges: Array<{
            node: {
              id: string;
              discount: {
                title?: string;
                status?: string;
                startsAt?: string;
                endsAt?: string | null;
                createdAt?: string;
              } | null;
            };
          }>;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
        };
      }>(`
        query GetDiscounts($first: Int!, $after: String) {
          discountNodes(first: $first, after: $after) {
            edges {
              node {
                id
                discount {
                  ... on DiscountAutomaticApp {
                    title
                    status
                    startsAt
                    endsAt
                    createdAt
                  }
                }
              }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      `, { first: 50, ...(cursor ? { after: cursor } : {}) });

      const edges = data.discountNodes?.edges || [];
      for (const edge of edges) {
        const d = edge.node.discount;
        if (!d?.title) continue;

        all.push({
          id: edge.node.id,
          title: d.title,
          status: d.status?.toLowerCase() || "active",
          startsAt: d.startsAt || "",
          endsAt: d.endsAt ?? undefined,
          createdAt: d.createdAt || "",
        });
      }

      cursor = data.discountNodes?.pageInfo?.endCursor ?? undefined;
      hasMore = data.discountNodes?.pageInfo?.hasNextPage || false;
      pages++;
    }

    // NOTE: In API 2025-01+, metafield access on DiscountAutomaticApp was removed.
    // DiscountNode IDs differ from DiscountAutomaticApp IDs, so node(id:) can't
    // resolve discount metafields. Config is managed at the application level instead.

    return all;
  }

  /**
   * Delete (deactivate) a discount
   */
  async function deleteDiscount(discountId: string): Promise<{ success: boolean; error?: string }> {
    const mutation = `
      mutation discountAutomaticAppUpdate($id: ID!, $input: DiscountAutomaticAppInput!) {
        discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $input) {
          automaticAppDiscount { id }
          userErrors { field message }
        }
      }
    `;

    try {
      const data = await api.graphql<DiscountUpdateResponse>(mutation, {
        id: discountId,
        input: { status: "INACTIVE" },
      });

      if (data.discountAutomaticAppUpdate?.userErrors?.length > 0) {
        return { success: false, error: data.discountAutomaticAppUpdate.userErrors[0].message };
      }

      logger.info({ shopDomain, discountId }, "Discount deactivated");
      return { success: true };
    } catch (error) {
      return { success: false, error: getErrorMessage(error) };
    }
  }

  /**
   * Get the deployed Function's GID by handle
   */
  async function getFunctionId(handle: string): Promise<string | null> {
    const data = await api.graphql<ExtensionListResponse>(`
      query GetFunction($handle: String!) {
        app {
          installation {
            app {
              extensions(first: 10, handle: $handle) {
                edges {
                  node {
                    id
                    handle
                    extensionApiType
                  }
                }
              }
            }
          }
        }
      }
    `, { handle });

    const extensions = data.app?.installation?.app?.extensions?.edges || [];
    const func = extensions.find((e) => e.node.extensionApiType === "FUNCTION");
    return func?.node?.id || null;
  }

  /**
   * List all deployed Functions for this app
   */
  async function listFunctions(): Promise<Array<{ id: string; handle: string; title: string }>> {
    const data = await api.graphql<ExtensionListResponse>(`
      query GetFunctions {
        app {
          installation {
            app {
              extensions(first: 50) {
                edges {
                  node {
                    id
                    handle
                    title
                    extensionApiType
                  }
                }
              }
            }
          }
        }
      }
    `);

    const extensions = data.app?.installation?.app?.extensions?.edges || [];
    return extensions
      .filter((e) => e.node.extensionApiType === "FUNCTION")
      .map((e) => ({
        id: e.node.id,
        handle: e.node.handle,
        title: e.node.title || e.node.handle,
      }));
  }

  return {
    createDiscount,
    updateDiscountConfig,
    listDiscounts,
    deleteDiscount,
    getFunctionId,
    listFunctions,
  };
}
