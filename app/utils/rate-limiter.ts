/**
 * File: utils/rate-limiter.ts
 * Author: yuntongsoft
 * Date: 2026/08/17
 * Purpose: Rate limiting with configurable backends (memory or Redis).
 *
 * Default: in-memory Map (single-process, suitable for development).
 * Production: set REDIS_URL to use Redis-backed rate limiting (multi-process safe).
 *
 * Dependencies: logger (redis is optional, dynamically imported)
 * Used by: All action handlers that perform write operations
 *
 * Usage:
 *   import { rateLimit, RATE_LIMIT_PRESETS } from "~/utils/rate-limiter";
 *   const blocked = await rateLimit(`key:${shopId}`, RATE_LIMIT_PRESETS.write);
 *   if (blocked) return json({ error: "Too many requests" }, { status: 429 });
 */
import { createLogger } from "~/utils/logger";
import { getErrorMessage } from "~/utils/errors";

const logger = createLogger({ module: "rate-limiter" });

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  retryAfter: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Presets
// ─────────────────────────────────────────────────────────────────────────────

export const RATE_LIMIT_PRESETS = {
  login: { max: 5, windowMs: 60_000 },      // 5 attempts per minute
  write: { max: 10, windowMs: 60_000 },      // 10 writes per minute
  api: { max: 60, windowMs: 60_000 },        // 60 API calls per minute
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// In-Memory Store (development / single-process)
// ─────────────────────────────────────────────────────────────────────────────

const memoryStore = new Map<string, RateLimitEntry>();

/** Maximum entries in memory store — prevents unbounded growth under attack. */
const MAX_MEMORY_ENTRIES = 10_000;

function memoryRateLimit(key: string, config: RateLimitConfig): RateLimitResult | null {
  const now = Date.now();
  const entry = memoryStore.get(key);

  if (!entry || now > entry.resetAt) {
    // Evict oldest entries if store is full (simple FIFO eviction)
    if (!entry && memoryStore.size >= MAX_MEMORY_ENTRIES) {
      const firstKey = memoryStore.keys().next().value;
      if (firstKey !== undefined) memoryStore.delete(firstKey);
    }
    memoryStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  if (entry.count >= config.max) {
    return { retryAfter: entry.resetAt - now };
  }

  entry.count++;
  return null;
}

/**
 * Clean up expired entries from the in-memory store.
 * Call periodically (e.g., every 5 minutes) to prevent memory leaks.
 */
export function cleanupRateLimitStore(): void {
  const now = Date.now();
  for (const [key, entry] of memoryStore.entries()) {
    if (now > entry.resetAt) {
      memoryStore.delete(key);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis Store (production / multi-process)
// ─────────────────────────────────────────────────────────────────────────────

let redisClient: unknown = null;
let redisChecked = false;

async function getRedisClient(): Promise<unknown | null> {
  if (redisChecked) return redisClient;
  redisChecked = true;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    // Dynamic import to avoid hard dependency on ioredis
    const Redis = (await import("ioredis")).default;
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    logger.info("Redis rate limiter connected");
    return redisClient;
  } catch (error) {
    logger.warn({ error: getErrorMessage(error) }, "Failed to connect Redis for rate limiting, falling back to memory");
    return null;
  }
}

async function redisRateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const redis = await getRedisClient() as any; // ioredis is an optional peer dep
  if (!redis) return memoryRateLimit(key, config);

  const redisKey = `ratelimit:${key}`;

  try {
    // Atomic increment — INCR creates the key with value 1 if it doesn't exist
    const count = await redis.incr(redisKey);

    // Set TTL only on the first request in this window
    if (count === 1) {
      await redis.pexpire(redisKey, config.windowMs);
    }

    if (count > config.max) {
      const pttl = await redis.pttl(redisKey) as number;
      const retryAfter = pttl > 0 ? pttl : config.windowMs;
      return { retryAfter };
    }

    return null;
  } catch (error) {
    logger.warn({ error: getErrorMessage(error) }, "Redis rate limit error, falling back to memory");
    return memoryRateLimit(key, config);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Unified API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a request should be rate-limited.
 *
 * Uses Redis if REDIS_URL is set (production), otherwise in-memory (development).
 *
 * @param key - Unique identifier (e.g., `discounts:${shopId}:${ip}`)
 * @param config - Rate limit configuration (max requests, window size)
 * @returns null if allowed, or `{ retryAfter }` in ms if blocked
 */
export async function rateLimit(key: string, config: RateLimitConfig): Promise<RateLimitResult | null> {
  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    return redisRateLimit(key, config);
  }

  return memoryRateLimit(key, config);
}

// Periodic cleanup for memory store (every 5 minutes)
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    if (!process.env.REDIS_URL) {
      cleanupRateLimitStore();
    }
  }, CLEANUP_INTERVAL);
  // Don't prevent process exit
  if (cleanupTimer.unref) cleanupTimer.unref();
}

// Auto-start cleanup in non-test environments
if (process.env.NODE_ENV !== "test") {
  startCleanup();
}
