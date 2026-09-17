/**
 * File: demo/services/function-registry.ts
 * Author: yuntongsoft
 * Date: 2026/09/07
 * Purpose: Maps business rule types to deployed Shopify Function IDs.
 *
 * ============================================================================
 * DEMO CODE — Delete app/demo/ to remove all demo code
 * ============================================================================
 *
 * After `shopify app deploy`, Function GIDs are stored here so the rule engine
 * can look them up without developers ever seeing Function IDs.
 *
 * In production, Function IDs are persisted in the database (ShopFunction table).
 * In development, they can also be set via environment variables.
 *
 * Dependencies: prisma, logger (infrastructure)
 */
import prisma from "~/db.server";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "function-registry" });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Supported rule types — each maps to a pre-built Shopify Function */
export type RuleType =
  | "order-discount"        // Spend threshold → percentage off
  | "free-shipping"         // Spend threshold → free shipping
  | "volume-discount"       // Buy N+ items → percentage off
  | "bogo";                 // Buy X get Y free

/** Maps rule type to its deployed Function GID */
interface FunctionMapping {
  ruleType: RuleType;
  functionId: string;
  /** Human-readable label for logging */
  label: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

class FunctionRegistry {
  /** In-memory cache with TTL to avoid repeated DB lookups. Entries expire after 5 minutes. */
  private cache = new Map<string, { value: string; expiresAt: number }>();
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  /**
   * Get the Function ID for a rule type, scoped to a specific shop.
   * Checks in-memory cache → environment variable → database.
   *
   * @param shopId - The shop's internal ID (multi-tenant isolation)
   * @param ruleType - The business rule type (e.g. "order-discount")
   * @returns The deployed Function GID
   * @throws If no Function is registered for the given type
   */
  async getFunctionId(shopId: string, ruleType: RuleType): Promise<string> {
    // 1. Check cache (keyed by shop + ruleType for isolation, with TTL)
    const cacheKey = `${shopId}:${ruleType}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) return cached.value;
    if (cached) this.cache.delete(cacheKey); // Expired entry

    // 2. Check environment variable (useful for development, shared across shops)
    const envKey = `FUNCTION_ID_${ruleType.replace(/-/g, "_").toUpperCase()}`;
    const envValue = process.env[envKey];
    if (envValue) {
      this.cache.set(cacheKey, { value: envValue, expiresAt: Date.now() + FunctionRegistry.CACHE_TTL_MS });
      logger.debug({ shopId, ruleType, functionId: envValue }, "Function ID loaded from env");
      return envValue;
    }

    // 3. Check database — scoped to shopId for multi-tenant isolation
    const mapping = await prisma.shopFunction.findFirst({
      where: { shopId, ruleType },
      select: { functionId: true },
    });

    if (mapping?.functionId) {
      this.cache.set(cacheKey, { value: mapping.functionId, expiresAt: Date.now() + FunctionRegistry.CACHE_TTL_MS });
      logger.debug({ shopId, ruleType, functionId: mapping.functionId }, "Function ID loaded from DB");
      return mapping.functionId;
    }

    throw new Error(
      `No Function registered for rule type "${ruleType}" in shop ${shopId}. ` +
      `Set ${envKey} in .env or deploy the Function and register it.`
    );
  }

  /**
   * Register or update a Function ID for a rule type, scoped to a specific shop.
   * Called after `shopify app deploy` with the new Function GID.
   *
   * @param shopId - The shop's internal ID (multi-tenant isolation)
   * @param ruleType - The business rule type
   * @param functionId - The deployed Function GID
   * @param label - Human-readable label
   */
  async register(shopId: string, ruleType: RuleType, functionId: string, label?: string): Promise<void> {
    // Update cache with TTL
    const cacheKey = `${shopId}:${ruleType}`;
    this.cache.set(cacheKey, { value: functionId, expiresAt: Date.now() + FunctionRegistry.CACHE_TTL_MS });
  
    // Persist to Database — scoped to shopId
    await prisma.shopFunction.upsert({
      where: { shopId_ruleType: { shopId, ruleType } },
      create: { shopId, ruleType, functionId, label: label || ruleType },
      update: { functionId, label: label || ruleType },
    });
  
    logger.info({ shopId, ruleType, functionId }, "Function ID registered");
  }

  /**
   * List all registered Function mappings for a specific shop.
   *
   * @param shopId - The shop's internal ID (multi-tenant isolation)
   */
  async listMappings(shopId: string): Promise<FunctionMapping[]> {
    const rows = await prisma.shopFunction.findMany({
      where: { shopId },
      select: { ruleType: true, functionId: true, label: true },
    });
    return rows.map((r) => ({
      ruleType: r.ruleType as RuleType,
      functionId: r.functionId,
      label: r.label,
    }));
  }

  /** Clear the in-memory cache (useful for testing) */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Remove expired entries from the cache.
   * Called periodically to prevent unbounded memory growth.
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now >= entry.expiresAt) this.cache.delete(key);
    }
  }
}

export const functionRegistry = new FunctionRegistry();

// Periodic cache cleanup every 10 minutes (don't prevent process exit)
const funcCacheCleanupTimer = setInterval(() => functionRegistry.cleanup(), 10 * 60 * 1000);
if (funcCacheCleanupTimer.unref) funcCacheCleanupTimer.unref();
