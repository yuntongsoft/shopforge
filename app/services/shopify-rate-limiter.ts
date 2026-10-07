/**
 * File: services/shopify-rate-limiter.ts
 * Author: yuntongsoft
 * Date: 2026/10/07
 * Purpose: Adaptive rate limit tracker for Shopify Admin API.
 *
 * Shopify uses a leaky bucket algorithm with a capacity of ~1000 calls.
 * The X-Shopify-Shop-Api-Call-Limit response header reports current usage
 * as "{used}/{capacity}". This module tracks that state per-shop and
 * applies adaptive delays to avoid hitting 429 errors.
 *
 * Design:
 * - In-memory storage with Redis + DB fallback chain (multi-process)
 * - Per-shop isolation (each shop has independent rate limits)
 * - Continuous delay curve: smooth interpolation replaces fixed zones
 * - 429 handling: respects Retry-After header from Shopify
 * - Circuit breaker: opens after consecutive 429s, blocks requests immediately
 * - Redis backend: writes on track/handle429, reads on acquire
 * - DB fallback: Prisma RateLimitCache — only written when Redis is unavailable or fails
 * - Monitoring: getMetrics()/getStats()/getHealth() expose telemetry
 *
 * Dependencies: logger (redis is optional, dynamically imported)
 * Used by: services/shopify/_core.ts (GraphQL client)
 *
 * Configuration (environment variables):
 * | Variable                       | Default                                                    | Description                              |
 * |------------------------------- |----------------------------------------------------------- |----------------------------------------- |
 * | RATE_LIMIT_DELAY_CURVE         | [[50,0],[70,50],[80,200],[90,600],[95,1200],[100,2000]]    | Delay curve breakpoints (JSON array)     |
 * | RATE_LIMIT_REFILL_RATE         | 50                                                         | Leaky bucket refill rate (calls/sec)     |
 * | RATE_LIMIT_STALE_THRESHOLD_MS  | 30000                                                      | Stale state threshold (ms)               |
 * | RATE_LIMIT_CB_THRESHOLD        | 5                                                          | Consecutive 429s before circuit opens    |
 * | RATE_LIMIT_CB_WINDOW_MS        | 60000                                                      | Time window for counting 429s (ms)       |
 * | RATE_LIMIT_CB_COOLDOWN_MS      | 30000                                                      | Open circuit cooldown before probe (ms)  |
 *
 * Usage:
 *   import { shopifyRateLimiter } from "~/services/shopify-rate-limiter";
 *
 *   // Before request: wait if rate limit is high
 *   await shopifyRateLimiter.acquire(shopDomain);
 *
 *   // After response: update state from headers
 *   shopifyRateLimiter.track(shopDomain, response);
 *
 *   // On 429: record backoff
 *   shopifyRateLimiter.handle429(shopDomain, response);
 *
 * @see services/shopify/_core.ts for integration pattern
 * @see docs/shopify-rate-limiter.md for architecture documentation
 */
import prisma from "~/db.server";
import { createLogger } from "~/utils/logger";
import { getErrorMessage } from "~/utils/errors";

const logger = createLogger({ module: "shopify-rate-limiter" });

// ─────────────────────────────────────────────────────────────────────────────
// Redis Client (optional, for multi-process state sharing)
// ─────────────────────────────────────────────────────────────────────────────

let redisClient: unknown = null;
let redisChecked = false;

async function getRedisClient(): Promise<unknown | null> {
  if (redisChecked) return redisClient;
  redisChecked = true;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  try {
    const Redis = (await import("ioredis")).default;
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    logger.info("Redis rate limiter connected");
    return redisClient;
  } catch (error) {
    logger.warn(
      { error: getErrorMessage(error) },
      "Failed to connect Redis for rate limiting, falling back to memory"
    );
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Redis Helpers
// ─────────────────────────────────────────────────────────────────────────────

const REDIS_KEY_PREFIX = "shopify-ratelimit:";
const REDIS_TTL_SEC = 300;

/** Serialize the shared fields of InternalState for remote storage */
function serializeState(state: InternalState): string {
  return JSON.stringify({
    used: state.used,
    capacity: state.capacity,
    lastUpdate: state.lastUpdate,
    blockedUntil: state.blockedUntil,
  });
}

async function writeToRedis(shop: string, state: InternalState): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const redis = (await getRedisClient()) as any;
  if (!redis) return false;

  try {
    const key = `${REDIS_KEY_PREFIX}${shop}`;
    await redis.set(key, serializeState(state), "EX", REDIS_TTL_SEC);
    return true;
  } catch (error) {
    logger.warn({ error: getErrorMessage(error) }, "Redis write failed");
    return false;
  }
}

/**
 * Persist state to remote storage with Redis→DB fallback.
 * - Redis available: write to Redis only (skip DB to reduce DB load)
 * - Redis unavailable or write fails: fall back to DB write
 *
 * This avoids the overhead of dual-writes on every API response while
 * ensuring data is persisted somewhere for cross-process sharing.
 */
async function persistState(shop: string, state: InternalState): Promise<void> {
  const redisAvailable = (await getRedisClient()) != null;
  if (redisAvailable) {
    const ok = await writeToRedis(shop, state);
    if (!ok) {
      // Redis write failed — fall back to DB to avoid data loss
      await writeToDb(shop, state);
    }
  } else {
    // Redis not configured or connection failed — use DB
    await writeToDb(shop, state);
  }
}

async function readFromRedis(shop: string): Promise<Omit<InternalState, "inFlight"> | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const redis = (await getRedisClient()) as any;
  if (!redis) return null;

  try {
    const key = `${REDIS_KEY_PREFIX}${shop}`;
    const value = await redis.get(key);
    if (!value) return null;

    const parsed = JSON.parse(value);
    // Schema guard: reject corrupted or incompatible data
    if (typeof parsed.used !== "number" || typeof parsed.capacity !== "number") {
      logger.warn({ shop }, "Redis rate limit data has invalid schema, ignoring");
      return null;
    }
    return parsed;
  } catch (error) {
    logger.warn({ error: getErrorMessage(error) }, "Redis read failed");
    return null;
  }
}

async function deleteFromRedis(shop: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const redis = (await getRedisClient()) as any;
  if (!redis) return;

  try {
    const key = `${REDIS_KEY_PREFIX}${shop}`;
    await redis.del(key);
  } catch (error) {
    logger.warn({ error: getErrorMessage(error) }, "Redis delete failed");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DB Fallback Helpers (when Redis is unavailable or write fails)
// ─────────────────────────────────────────────────────────────────────────────

const DB_TTL_SEC = 300;

async function writeToDb(shop: string, state: InternalState): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + DB_TTL_SEC * 1000);
    const value = serializeState(state);
    await prisma.rateLimitCache.upsert({
      where: { shopDomain: shop },
      update: { state: value, expiresAt },
      create: { shopDomain: shop, state: value, expiresAt },
    });
  } catch (error) {
    logger.warn({ error: getErrorMessage(error) }, "DB rate limit write failed");
  }
}

async function readFromDb(shop: string): Promise<Omit<InternalState, "inFlight"> | null> {
  try {
    const row = await prisma.rateLimitCache.findUnique({
      where: { shopDomain: shop },
    });
    if (!row || row.expiresAt < new Date()) return null;

    const parsed = JSON.parse(row.state);
    if (typeof parsed.used !== "number" || typeof parsed.capacity !== "number") {
      logger.warn({ shop }, "DB rate limit data has invalid schema, ignoring");
      return null;
    }
    return parsed;
  } catch (error) {
    logger.warn({ error: getErrorMessage(error) }, "DB rate limit read failed");
    return null;
  }
}

async function deleteFromDb(shop: string): Promise<void> {
  try {
    await prisma.rateLimitCache.delete({ where: { shopDomain: shop } });
  } catch {
    // Ignore — row may not exist
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimitState {
  /** Number of API calls used in current bucket window */
  used: number;
  /** Total bucket capacity (typically 1000) */
  capacity: number;
  /** Usage percentage (0-100) */
  usagePercent: number;
  /** Current zone based on usage */
  zone: "green" | "yellow" | "orange" | "red";
  /** Recommended delay in ms before next request */
  delayMs: number;
  /** Timestamp of last update */
  lastUpdate: number;
  /** If set, requests should wait until this timestamp (429 backoff) */
  blockedUntil: number;
}

/**
 * Internal per-shop state tracked in memory.
 * Only the shared fields (used, capacity, lastUpdate, blockedUntil) are persisted
 * to Redis/DB; inFlight is process-local and not serialized.
 */
interface InternalState {
  /** API calls used in current bucket window (from Shopify header) */
  used: number;
  /** Total bucket capacity (typically 1000) */
  capacity: number;
  /** Timestamp of last header update (ms since epoch) */
  lastUpdate: number;
  /** If set, requests must wait until this timestamp (429 backoff) */
  blockedUntil: number;
  /** Number of requests currently in-flight (acquire'd but not yet release'd) */
  inFlight: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit Breaker
// ─────────────────────────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half_open";

/**
 * Circuit breaker state for a single shop.
 * State machine: CLOSED → OPEN (after threshold 429s) → HALF_OPEN (after cooldown) → CLOSED (on success) or OPEN (on failure).
 */
export interface CircuitBreakerState {
  /** Current state: closed (normal), open (blocking), half_open (probing) */
  state: CircuitState;
  /** Number of consecutive 429s within the sliding window */
  consecutive429s: number;
  /** Timestamp when circuit last transitioned to OPEN (0 if never opened) */
  openedAt: number;
  /** Timestamp of the most recent 429 (0 if never received) */
  last429At: number;
}

/** Consecutive 429s within the window before circuit opens (override: RATE_LIMIT_CB_THRESHOLD) */
const CB_OPEN_THRESHOLD = parseInt(process.env.RATE_LIMIT_CB_THRESHOLD || "5", 10);
/** Time window for counting consecutive 429s (override: RATE_LIMIT_CB_WINDOW_MS) */
const CB_OPEN_WINDOW_MS = parseInt(process.env.RATE_LIMIT_CB_WINDOW_MS || "60000", 10);
/** How long the circuit stays open before allowing a probe request (override: RATE_LIMIT_CB_COOLDOWN_MS) */
const CB_COOLDOWN_MS = parseInt(process.env.RATE_LIMIT_CB_COOLDOWN_MS || "30000", 10);

// ─────────────────────────────────────────────────────────────────────────────
// Continuous delay curve (replaces fixed 4-zone step function)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse DELAY_CURVE from env var (JSON array of [percent, ms] pairs).
 * Returns null if the env var is unset or the data is malformed.
 */
function parseDelayCurve(raw: string | undefined): [number, number][] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length < 2) return null;
    for (const point of parsed) {
      if (!Array.isArray(point) || point.length !== 2 ||
          typeof point[0] !== "number" || typeof point[1] !== "number") {
        return null;
      }
    }
    return parsed as [number, number][];
  } catch {
    return null;
  }
}

const DEFAULT_DELAY_CURVE: [number, number][] = [
  [50, 0],
  [70, 50],
  [80, 200],
  [90, 600],
  [95, 1200],
  [100, 2000],
];

/**
 * Delay curve breakpoints: [usagePercent, delayMs].
 * Linear interpolation between points gives a smooth ramp instead of
 * abrupt jumps at zone boundaries. Below DELAY_CURVE[0] the delay is 0;
 * above DELAY_CURVE[last] the delay is capped at the last value.
 *
 * Override via RATE_LIMIT_DELAY_CURVE env var (JSON array):
 *   RATE_LIMIT_DELAY_CURVE='[[50,0],[70,50],[80,200],[90,600],[95,1200],[100,2000]]'
 *
 * Shopify's leaky bucket refills at ~50 calls/sec (capacity ~1000).
 * At 50% usage we still have ~500 calls of burst headroom, so no delay.
 * Above 50% the delay ramps via linear interpolation to discourage sustained high usage.
 */
const DELAY_CURVE: [number, number][] = (() => {
  const envCurve = parseDelayCurve(process.env.RATE_LIMIT_DELAY_CURVE);
  if (envCurve) {
    logger.info({ curve: envCurve }, "Delay curve loaded from RATE_LIMIT_DELAY_CURVE env var");
    return envCurve;
  }
  return DEFAULT_DELAY_CURVE;
})();

/** Shopify leaky bucket refill rate: ~50 calls per second (override: RATE_LIMIT_REFILL_RATE) */
const REFILL_RATE_PER_SEC = parseInt(process.env.RATE_LIMIT_REFILL_RATE || "50", 10);

/** Stale threshold: if no update for this long, assume bucket fully refilled (override: RATE_LIMIT_STALE_THRESHOLD_MS) */
const STALE_THRESHOLD_MS = parseInt(process.env.RATE_LIMIT_STALE_THRESHOLD_MS || "30000", 10);

/**
 * Compute delay via linear interpolation on the curve.
 * Returns 0 below the threshold, capped at the max above 100%.
 */
function computeDelay(usagePercent: number): number {
  if (usagePercent <= DELAY_CURVE[0][0]) return 0;

  for (let i = 1; i < DELAY_CURVE.length; i++) {
    const [p0, d0] = DELAY_CURVE[i - 1];
    const [p1, d1] = DELAY_CURVE[i];
    if (usagePercent <= p1) {
      const t = (usagePercent - p0) / (p1 - p0);
      return Math.round(d0 + t * (d1 - d0));
    }
  }

  return DELAY_CURVE[DELAY_CURVE.length - 1][1];
}

/**
 * Map usage percent to a zone label for logging/monitoring.
 * Zones are kept for human-readable reporting; the actual delay comes from computeDelay().
 */
function getZone(usagePercent: number): { zone: RateLimitState["zone"]; delayMs: number } {
  const delayMs = computeDelay(usagePercent);
  let zone: RateLimitState["zone"];
  if (usagePercent < 60) zone = "green";
  else if (usagePercent < 80) zone = "yellow";
  else if (usagePercent < 90) zone = "orange";
  else zone = "red";
  return { zone, delayMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// Monitoring Metrics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Aggregated monitoring metrics (process-lifetime counters).
 * Reset to zero on resetAll(). Use getMetrics() to read.
 */
export interface RateLimitMetrics {
  /** Total requests that passed the circuit breaker */
  totalRequests: number;
  /** Total 429 responses received */
  total429s: number;
  /** Total number of times a delay was applied */
  totalDelays: number;
  /** Cumulative delay time in milliseconds */
  totalDelayMs: number;
  /** Number of times the circuit breaker tripped (CLOSED → OPEN) */
  circuitBreakerTrips: number;
  /** Timestamp when metrics were last reset */
  since: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tracker
// ─────────────────────────────────────────────────────────────────────────────

class ShopifyRateLimitTracker {
  private states = new Map<string, InternalState>();
  private circuits = new Map<string, CircuitBreakerState>();
  private metrics: RateLimitMetrics = {
    totalRequests: 0,
    total429s: 0,
    totalDelays: 0,
    totalDelayMs: 0,
    circuitBreakerTrips: 0,
    since: Date.now(),
  };

  /** Maximum tracked shops — prevents unbounded memory growth */
  private static MAX_SHOPS = 5000;

  /**
   * Sync state from remote storage (multi-process setup).
   * Tries Redis first, falls back to DB if Redis has no data.
   * If remote has fresher data, merge into local state (preserve inFlight).
   */
  private async syncFromRemote(shop: string): Promise<void> {
    let remote = await readFromRedis(shop);
    if (!remote) {
      remote = await readFromDb(shop);
    }
    if (!remote) return;

    const local = this.states.get(shop);
    if (!local || remote.lastUpdate > local.lastUpdate) {
      this.states.set(shop, {
        used: remote.used,
        capacity: remote.capacity,
        lastUpdate: remote.lastUpdate,
        blockedUntil: remote.blockedUntil,
        inFlight: local?.inFlight || 0,
      });
    }
  }

  /**
   * Parse the X-Shopify-Shop-Api-Call-Limit header.
   * Format: "{used}/{capacity}" e.g. "42/1000"
   *
   * @param header - Raw header value from Shopify response
   * @returns Parsed used/capacity pair, or null if header is missing/malformed
   */
  parseLimitHeader(header: string | null): { used: number; capacity: number } | null {
    if (!header) return null;

    const match = header.match(/^(\d+)\/(\d+)$/);
    if (!match) {
      logger.warn({ header }, "Invalid rate limit header format");
      return null;
    }

    return {
      used: parseInt(match[1], 10),
      capacity: parseInt(match[2], 10),
    };
  }

  /**
   * Estimate current bucket usage, accounting for leaky bucket refill.
   * Shopify refills at ~50 calls/sec, so after idle time the bucket drains.
   */
  private estimateUsed(state: InternalState, now: number): number {
    const elapsedSec = (now - state.lastUpdate) / 1000;
    const refilled = Math.floor(elapsedSec * REFILL_RATE_PER_SEC);
    return Math.max(0, state.used - refilled + state.inFlight);
  }

  /**
   * Update rate limit state from a response's headers.
   * Called after every API response (including 429).
   * Persists state via Redis→DB fallback chain (fire-and-forget).
   *
   * @param shop - Shop domain (e.g. "mystore.myshopify.com")
   * @param response - HTTP response from Shopify Admin API
   */
  track(shop: string, response: Response): void {
    const header = response.headers.get("X-Shopify-Shop-Api-Call-Limit");
    const parsed = this.parseLimitHeader(header);
    if (!parsed) return;

    const now = Date.now();
    const existing = this.states.get(shop);

    if (existing && existing.lastUpdate > now - 100) {
      if (parsed.used <= existing.used) return;
    }

    const newState: InternalState = {
      used: parsed.used,
      capacity: parsed.capacity,
      lastUpdate: now,
      blockedUntil: existing?.blockedUntil || 0,
      inFlight: Math.max(0, (existing?.inFlight || 1) - 1),
    };

    this.states.set(shop, newState);

    if (this.states.size > ShopifyRateLimitTracker.MAX_SHOPS) {
      this.evictOldest();
    }

    const usagePercent = (parsed.used / parsed.capacity) * 100;
    const { zone } = getZone(usagePercent);

    if (zone === "orange" || zone === "red") {
      logger.warn(
        { shop, used: parsed.used, capacity: parsed.capacity, usagePercent: usagePercent.toFixed(1), zone },
        "Shopify API rate limit approaching threshold"
      );
    }

    void persistState(shop, newState);
  }

  /**
   * Handle a 429 Too Many Requests response.
   * Reads Retry-After header and blocks the shop until that time.
   * Only updates blockedUntil — preserves used/capacity from the preceding track() call.
   * Persists state via Redis→DB fallback chain (fire-and-forget).
   *
   * @param shop - Shop domain
   * @param response - 429 response from Shopify (must include Retry-After header)
   */
  handle429(shop: string, response: Response): void {
    const now = Date.now();
    const retryAfter = response.headers.get("Retry-After");
    const retrySeconds = retryAfter ? parseInt(retryAfter, 10) : 2;
    const blockedUntil = now + (isNaN(retrySeconds) ? 2000 : retrySeconds * 1000);

    const existing = this.states.get(shop);
    const newState: InternalState = {
      used: existing?.used ?? 1000,
      capacity: existing?.capacity ?? 1000,
      lastUpdate: existing?.lastUpdate ?? now,
      blockedUntil,
      inFlight: existing?.inFlight ?? 0,
    };

    this.states.set(shop, newState);

    // Circuit breaker: track consecutive 429s
    const circuit = this.circuits.get(shop);
    const consecutive = (circuit && now - circuit.last429At < CB_OPEN_WINDOW_MS)
      ? circuit.consecutive429s + 1
      : 1;

    // Determine new circuit state: open if threshold reached or if half_open probe failed
    let newCircuitState: CircuitState;
    if (consecutive >= CB_OPEN_THRESHOLD || circuit?.state === "half_open") {
      newCircuitState = "open";
    } else {
      newCircuitState = circuit?.state ?? "closed";
    }

    this.circuits.set(shop, {
      state: newCircuitState,
      consecutive429s: consecutive,
      openedAt: consecutive >= CB_OPEN_THRESHOLD ? now : (circuit?.openedAt ?? 0),
      last429At: now,
    });

    if (consecutive >= CB_OPEN_THRESHOLD) {
      logger.error(
        { shop, consecutive429s: consecutive, cooldownMs: CB_COOLDOWN_MS },
        "Circuit breaker OPEN — too many consecutive 429s"
      );
      this.metrics.circuitBreakerTrips++;
    }

    this.metrics.total429s++;

    logger.error(
      { shop, retryAfterSeconds: retrySeconds, blockedUntil: new Date(blockedUntil).toISOString() },
      "Shopify API rate limit exceeded (429), backing off"
    );

    void persistState(shop, newState);
  }

  /**
   * Wait if necessary before making a request.
   * Syncs from Redis (multi-process), then applies adaptive delay based on
   * estimated current bucket usage. Increments inFlight counter — caller
   * MUST call release() after the response.
   *
   * @param shop - Shop domain
   * @param priority - "critical" skips yellow zone delays
   */
  async acquire(shop: string, priority: "normal" | "critical" = "normal"): Promise<void> {
    // Circuit breaker check — reject immediately if circuit is open
    const circuit = this.circuits.get(shop);
    if (circuit?.state === "open") {
      const now = Date.now();
      if (now - circuit.openedAt < CB_COOLDOWN_MS) {
        throw new Error(
          `Circuit breaker OPEN for ${shop} (${circuit.consecutive429s} consecutive 429s). ` +
          `Cooldown ${Math.ceil((CB_COOLDOWN_MS - (now - circuit.openedAt)) / 1000)}s remaining.`
        );
      }
      // Cooldown expired → transition to half_open for probing
      circuit.state = "half_open";
      logger.info({ shop }, "Circuit breaker HALF_OPEN — allowing probe request");
    }

    // Count every request that passes the circuit breaker (regardless of delay path)
    this.metrics.totalRequests++;

    // Only sync from remote when local state is missing or stale (>5s old)
    // This avoids a remote round-trip on every request in the hot path
    const local = this.states.get(shop);
    if (!local || Date.now() - local.lastUpdate > 5000) {
      await this.syncFromRemote(shop);
    }

    const state = this.states.get(shop);
    if (!state) return;

    const now = Date.now();

    if (state.blockedUntil > now) {
      const waitMs = state.blockedUntil - now;
      logger.warn(
        { shop, waitMs, blockedUntil: new Date(state.blockedUntil).toISOString() },
        "Rate limit backoff active, waiting"
      );
      await sleep(waitMs);
      state.inFlight++;
      return;
    }

    // If state is stale (no update for 30s+), bucket has likely refilled — skip delay
    if (now - state.lastUpdate > STALE_THRESHOLD_MS) {
      state.inFlight++;
      return;
    }

    const estimatedUsed = this.estimateUsed(state, now);
    const usagePercent = (estimatedUsed / state.capacity) * 100;
    const { zone, delayMs } = getZone(usagePercent);

    if (priority === "critical" && zone === "yellow") {
      state.inFlight++;
      return;
    }

    if (delayMs > 0) {
      logger.info(
        { shop, zone, usagePercent: usagePercent.toFixed(1), delayMs, estimatedUsed },
        "Applying rate limit delay"
      );
      this.metrics.totalDelays++;
      this.metrics.totalDelayMs += delayMs;
      await sleep(delayMs);
    }

    state.inFlight++;
  }

  /**
   * Release an inFlight slot. Call after the API response is received
   * (regardless of success/failure). Typically called in a finally block.
   *
   * @param shop - Shop domain
   */
  release(shop: string): void {
    const state = this.states.get(shop);
    if (state && state.inFlight > 0) {
      state.inFlight--;
    }
  }

  /**
   * Record a successful API response (non-429).
   * Resets the consecutive 429 counter and closes the circuit if half_open.
   * Called by _core.ts after a successful response.
   *
   * @param shop - Shop domain
   */
  recordSuccess(shop: string): void {
    const circuit = this.circuits.get(shop);
    if (!circuit) return;

    if (circuit.state === "half_open") {
      logger.info({ shop }, "Circuit breaker CLOSED — probe request succeeded");
    }

    this.circuits.set(shop, {
      state: "closed",
      consecutive429s: 0,
      openedAt: 0,
      last429At: circuit.last429At,
    });
  }

  /**
   * Get current rate limit state for a shop (for monitoring/health checks).
   * Syncs from Redis first to get latest cross-process state.
   *
   * @param shop - Shop domain
   * @returns Current rate limit state with estimated usage, or null if shop is not tracked
   */
  async getState(shop: string): Promise<RateLimitState | null> {
    await this.syncFromRemote(shop);

    const state = this.states.get(shop);
    if (!state) return null;

    const now = Date.now();
    const estimatedUsed = this.estimateUsed(state, now);
    const usagePercent = (estimatedUsed / state.capacity) * 100;
    const { zone, delayMs } = getZone(usagePercent);

    return {
      used: estimatedUsed,
      capacity: state.capacity,
      usagePercent,
      zone,
      delayMs,
      lastUpdate: state.lastUpdate,
      blockedUntil: state.blockedUntil,
    };
  }

  /**
   * Get rate limit stats for all tracked shops (for health check endpoint).
   * Syncs each shop from Redis for cross-process accuracy.
   *
   * @returns Map of shop domain → current rate limit state
   */
  async getStats(): Promise<Record<string, RateLimitState>> {
    const shops = Array.from(this.states.keys());

    // Parallel remote reads — avoids O(n) serial round-trips
    await Promise.allSettled(shops.map((shop) => this.syncFromRemote(shop)));

    const result: Record<string, RateLimitState> = {};
    const now = Date.now();

    for (const [shop, currentState] of this.states.entries()) {
      const estimatedUsed = this.estimateUsed(currentState, now);
      const usagePercent = (estimatedUsed / currentState.capacity) * 100;
      const { zone, delayMs } = getZone(usagePercent);

      result[shop] = {
        used: estimatedUsed,
        capacity: currentState.capacity,
        usagePercent,
        zone,
        delayMs,
        lastUpdate: currentState.lastUpdate,
        blockedUntil: currentState.blockedUntil,
      };
    }

    return result;
  }

  /**
   * Get combined health info for a shop: rate limit state + circuit breaker state.
   * For health check endpoints and monitoring dashboards.
   *
   * @param shop - Shop domain
   * @returns Object with rateLimit (null if not tracked) and circuit state
   */
  async getHealth(shop: string): Promise<{
    rateLimit: RateLimitState | null;
    circuit: CircuitBreakerState;
  }> {
    const rateLimit = await this.getState(shop);
    const circuit = this.circuits.get(shop) ?? {
      state: "closed" as const,
      consecutive429s: 0,
      openedAt: 0,
      last429At: 0,
    };

    return { rateLimit, circuit };
  }

  /**
   * Get circuit breaker state for a shop (sync, no Redis).
   *
   * @param shop - Shop domain
   * @returns Current circuit breaker state (defaults to closed if never seen)
   */
  getCircuitState(shop: string): CircuitBreakerState {
    return this.circuits.get(shop) ?? {
      state: "closed",
      consecutive429s: 0,
      openedAt: 0,
      last429At: 0,
    };
  }

  /**
   * Get aggregated monitoring metrics (process-lifetime counters).
   * Used by the health check endpoint to expose rate limiter telemetry.
   *
   * @returns Copy of current metrics (safe to mutate)
   */
  getMetrics(): RateLimitMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset state for a shop (used in tests or after token refresh).
   * Also deletes from Redis and DB.
   *
   * @param shop - Shop domain to reset
   */
  async reset(shop: string): Promise<void> {
    this.states.delete(shop);
    this.circuits.delete(shop);
    await deleteFromRedis(shop);
    await deleteFromDb(shop);
  }

  /**
   * Reset all state (used in tests).
   * Clears in-memory state, Redis keys, and DB rows for all known shops.
   */
  async resetAll(): Promise<void> {
    const shops = Array.from(this.states.keys());
    this.states.clear();
    this.circuits.clear();
    this.metrics = {
      totalRequests: 0,
      total429s: 0,
      totalDelays: 0,
      totalDelayMs: 0,
      circuitBreakerTrips: 0,
      since: Date.now(),
    };
    for (const shop of shops) {
      await deleteFromRedis(shop);
      await deleteFromDb(shop);
    }
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestTime = Infinity;

    for (const [key, state] of this.states.entries()) {
      if (state.lastUpdate < oldestTime) {
        oldestTime = state.lastUpdate;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.states.delete(oldestKey);
      void deleteFromRedis(oldestKey);
      void deleteFromDb(oldestKey);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton
// ─────────────────────────────────────────────────────────────────────────────

export const shopifyRateLimiter = new ShopifyRateLimitTracker();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
