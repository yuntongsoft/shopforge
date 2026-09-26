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
import { createLogger } from "~/utils/logger.server";

const logger = createLogger({ module: "db" });

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// ─── URL helpers ─────────────────────────────────────────────────────────────

const isSQLite = (url: string) => url.startsWith("file:");

const isServerless = () =>
  process.env.VERCEL === "1" || process.env.AWS_LAMBDA === "1";

/**
 * Check whether a query string already defines `connection_limit`.
 * We parse the URL instead of doing a naive string search so that
 * occurrences in the password or path are not misidentified.
 */
const urlHasConnectionLimit = (url: string): boolean => {
  try {
    return new URL(url).searchParams.has("connection_limit");
  } catch {
    return false;
  }
};

/**
 * Supplement a database URL with default pool parameters.
 * Explicit params in the URL are never overwritten.
 * SQLite URLs are returned untouched (file-based, no pooling).
 */
function withPoolParams(url: string): string {
  if (isSQLite(url) || urlHasConnectionLimit(url)) return url;

  const parsed = new URL(url);
  const defaults: Record<string, string> = isServerless()
    ? { connection_limit: "1", pool_timeout: "30", connect_timeout: "30" }
    : { connection_limit: "10", pool_timeout: "30", connect_timeout: "10" };

  for (const [key, value] of Object.entries(defaults)) {
    if (!parsed.searchParams.has(key)) {
      parsed.searchParams.set(key, value);
    }
  }
  return parsed.toString();
}

// ─── Sensitive-log redaction ────────────────────────────────────────────────

const SENSITIVE_RE =
  /(?:secret|token|password|key|bearer)[\s=:]+[^\s,;]+|[\w.+-]+@[\w-]+\.[\w.-]+/gi;

function redact(message: string): string {
  return message.replace(SENSITIVE_RE, "********");
}

// ─── Client factory ─────────────────────────────────────────────────────────

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set");
  }

  const url = withPoolParams(databaseUrl);

  const client = new PrismaClient({
    log: [
      { emit: "event", level: "error" },
      { emit: "event", level: "warn" },
    ],
    datasources: { db: { url } },
  });

  // Attach event-based log listeners that redact PII / credentials
  client.$on("error" as never, ((e: { message: string }) => {
    logger.error(redact(e.message));
  }) as never);
  client.$on("warn" as never, ((e: { message: string }) => {
    logger.warn(redact(e.message));
  }) as never);

  return client;
}

// ─── Singleton (dev hot-reload safe) ────────────────────────────────────────

const prisma = (globalThis.__prisma as PrismaClient | undefined) ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__prisma = prisma;
}

export default prisma;
