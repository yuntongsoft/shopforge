/**
 * File: services/shopify/collections.ts
 * Author: yuntongsoft
 * Date: 2026/08/13
 * Purpose: Collection queries — list and products within a collection.
 */
import type { ShopifyCollection } from "./types";

interface CollectionResponse {
  collections?: {
    edges: Array<{ node: { id: string; title: string; handle: string; productsCount: { count: number } } }>;
  };
}

interface CollectionProductsResponse {
  collection?: {
    products: {
      edges: Array<{ node: { id: string; title: string; images: { edges: Array<{ node: { url: string } }> } } }>;
    };
  };
}

export function createCollectionsModule(graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>) {
  async function getCollections(options: { first?: number; query?: string } = {}): Promise<ShopifyCollection[]> {
    const { first = 50, query } = options;

    const data = await graphql<CollectionResponse>(`
      query GetCollections($first: Int!${query ? ", $query: String" : ""}) {
        collections(first: $first${query ? ", query: $query" : ""}) {
          edges {
            node {
              id title handle
              productsCount { count }
            }
          }
        }
      }
    `, { first, ...(query ? { query } : {}) });

    return (data.collections?.edges || []).map((edge) => ({
      id: edge.node.id,
      title: edge.node.title,
      handle: edge.node.handle,
      productsCount: edge.node.productsCount?.count || 0,
    }));
  }

  async function getCollectionProducts(
    collectionId: string,
    first = 20
  ): Promise<Array<{ id: string; title: string; image?: string }>> {
    const data = await graphql<CollectionProductsResponse>(`
      query GetCollectionProducts($id: ID!, $first: Int!) {
        collection(id: $id) {
          products(first: $first) {
            edges {
              node {
                id title
                images(first: 1) { edges { node { url } } }
              }
            }
          }
        }
      }
    `, { id: collectionId, first });

    return (data.collection?.products?.edges || []).map((edge) => ({
      id: edge.node.id,
      title: edge.node.title,
      image: edge.node.images?.edges?.[0]?.node?.url,
    }));
  }

  return { getCollections, getCollectionProducts };
}
