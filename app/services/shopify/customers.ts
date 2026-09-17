/**
 * File: services/shopify/customers.ts
 * Author: yuntongsoft
 * Date: 2026/08/14
 * Purpose: Customer queries — list and search.
 */

interface CustomerResponse {
  customers?: {
    edges: Array<{
      node: {
        id: string;
        displayName: string;
        numberOfOrders: number;
        totalSpent: { amount: string };
      };
    }>;
  };
}

export function createCustomersModule(graphql: <T>(query: string, variables?: Record<string, unknown>) => Promise<T>) {
  async function getCustomers(options: { first?: number; query?: string } = {}): Promise<
    Array<{ id: string; displayName: string; numberOfOrders: number; totalSpent: string }>
  > {
    const { first = 20, query } = options;

    const data = await graphql<CustomerResponse>(`
      query GetCustomers($first: Int!${query ? ", $query: String" : ""}) {
        customers(first: $first${query ? ", query: $query" : ""}) {
          edges {
            node { id displayName numberOfOrders totalSpent { amount } }
          }
        }
      }
    `, { first, ...(query ? { query } : {}) });

    return (data.customers?.edges || []).map((edge) => ({
      id: edge.node.id,
      displayName: edge.node.displayName || "",
      numberOfOrders: edge.node.numberOfOrders || 0,
      totalSpent: edge.node.totalSpent?.amount || "0",
    }));
  }

  return { getCustomers };
}
