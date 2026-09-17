/**
 * File: services/shopify/products.ts
 * Author: yuntongsoft
 * Date: 2026/08/08
 * Purpose: Product queries — list, search, cursor pagination.
 */
import type { ShopifyProduct, PaginatedResult, ProductQueryOptions, GraphQLProductNode } from "./types";

/** Flatten a GraphQL product node into a clean ShopifyProduct object */
function flattenProduct(node: GraphQLProductNode): ShopifyProduct {
  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    status: node.status,
    vendor: node.vendor || "",
    productType: node.productType || "",
    image: node.images?.edges?.[0]?.node?.url,
    variants: (node.variants?.edges || []).map((v) => ({
      id: v.node.id,
      title: v.node.title,
      price: v.node.price,
      compareAtPrice: v.node.compareAtPrice || undefined,
      sku: v.node.sku || "",
      inventoryQuantity: v.node.inventoryQuantity || 0,
    })),
  };
}

interface ProductResponse {
  products?: {
    edges: Array<{ node: GraphQLProductNode }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export function createProductsModule(graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>) {
  async function getProducts(options: ProductQueryOptions = {}): Promise<PaginatedResult<ShopifyProduct>> {
    const { first = 20, after, query } = options;

    const data = await graphql<ProductResponse>(`
      query GetProducts($first: Int!${after ? ", $after: String" : ""}${query ? ", $query: String" : ""}) {
        products(first: $first${after ? ", after: $after" : ""}${query ? ", query: $query" : ""}) {
          edges {
            node {
              id title handle status vendor productType
              images(first: 1) { edges { node { url } } }
              variants(first: 50) {
                edges {
                  node { id title price compareAtPrice sku inventoryQuantity }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `, { first, ...(after ? { after } : {}), ...(query ? { query } : {}) });

    const edges = data.products?.edges || [];
    return {
      items: edges.map((edge) => flattenProduct(edge.node)),
      hasNextPage: data.products?.pageInfo?.hasNextPage || false,
      endCursor: data.products?.pageInfo?.endCursor ?? undefined,
    };
  }

  /**
   * Fetch all products across all pages.
   * Safety limit: max 20 pages (1000 products) to prevent runaway queries.
   */
  async function getAllProducts(query?: string): Promise<ShopifyProduct[]> {
    const all: ShopifyProduct[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    const MAX_PAGES = 20; // Safety valve: cap at 1000 products
    let pages = 0;

    while (hasMore && pages < MAX_PAGES) {
      const result = await getProducts({ first: 50, after: cursor, query });
      all.push(...result.items);
      cursor = result.endCursor;
      hasMore = result.hasNextPage;
      pages++;
    }

    return all;
  }

  return { getProducts, getAllProducts };
}
