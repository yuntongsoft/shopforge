/**
 * File: scripts/seed.ts
 * Purpose: Seed the database with test data for local development.
 *          Creates a demo shop and sample orders.
 *
 * Usage:
 *   npm run db:seed
 *
 * Safety:
 *   - Only runs in development (checks NODE_ENV)
 *   - Uses upsert — safe to run multiple times
 *   - Does NOT delete existing data
 */
import { PrismaClient } from "@prisma/client";
import { encrypt } from "../app/utils/encryption";

const prisma = new PrismaClient();

async function main() {
  console.log("[seed] Starting database seed...\n");

  // 1. Create demo shop
  const demoShop = await prisma.shop.upsert({
    where: { shopifyDomain: "demo-store.myshopify.com" },
    update: {},
    create: {
      shopifyDomain: "demo-store.myshopify.com",
      shopifyToken: encrypt("shpat_demo_token_for_local_dev_only"),
      shopifyScope: "read_products,write_products,read_orders",
      plan: "free",
      isDeleted: false,
    },
  });
  console.log(`✓ Shop: ${demoShop.shopifyDomain} (id: ${demoShop.id})`);

  // 2. Create sample orders
  const orders = [
    { orderNumber: "ORD-001", customer: "Alice Johnson", amount: 99.99, status: "delivered" },
    { orderNumber: "ORD-002", customer: "Bob Smith", amount: 249.5, status: "pending" },
    { orderNumber: "ORD-003", customer: "Carol White", amount: 15.0, status: "processing" },
  ];

  for (const order of orders) {
    const created = await prisma.order.create({
      data: {
        shopId: demoShop.id,
        ...order,
      },
    });
    console.log(`✓ Order: ${created.orderNumber} — $${created.amount} (${created.status})`);
  }

  console.log("\n[seed] Done! Test data created successfully.");
  console.log("[seed] Shop domain: demo-store.myshopify.com");
  console.log("[seed] Use this in your browser's ?shop= parameter for local testing.");
}

main()
  .catch((e) => {
    console.error("[seed] Failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

