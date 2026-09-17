/**
 * File: db.server.ts
 * Author: yuntongsoft
 * Date: 2026/08/03
 * Purpose: Prisma client singleton with environment-aware connection pooling
 *
 * Dependencies: @prisma/client
 * Used by: All routes and services that access the database
 *
 * Usage:
 *   import prisma from "~/db.server";
 *   const shop = await prisma.shop.findUnique({ where: { shopifyDomain: "example.myshopify.com" } });
 */
import { PrismaClient } from "@prisma/client";

declare global {
  var __prisma: PrismaClient | undefined;
}

/**
 * Create a Prisma client with environment-specific connection settings.
 *
 * - Serverless (Vercel/AWS Lambda): connection_limit=1 to avoid connection explosion
 * - Standalone server: connection_limit=10 for better throughput
 */
function createPrismaClient() {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA === "1";
  const url = !baseUrl.includes("connection_limit")
    ? `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${isServerless ? "connection_limit=1&pool_timeout=30&connect_timeout=30" : "connection_limit=10&pool_timeout=30&connect_timeout=10"}`
    : baseUrl;

  return new PrismaClient({
    log: process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error", "warn"],
    datasources: {
      db: { url },
    },
  });
}

const prisma = global.__prisma ?? createPrismaClient();

// Warm up connection in production
if (process.env.NODE_ENV === "production") {
  prisma.$connect().catch((err: Error) => {
    console.error("[Prisma] Failed to connect:", err.message);
  });
}

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}

export default prisma;
