/**
 * Tests for shopify-rate-limiter.ts — Adaptive rate limit tracking + circuit breaker
 *
 * Coverage:
 *   - parseLimitHeader: valid format, invalid format, null
 *   - track: updates state from response headers
 *   - track: logs warning on orange/red zones
 *   - handle429: sets blockedUntil from Retry-After
 *   - handle429: defaults to 2s when Retry-After missing
 *   - acquire: no delay in green zone
 *   - acquire: applies delay in yellow/orange/red zones
 *   - acquire: waits for 429 backoff
 *   - acquire: critical priority skips yellow zone
 *   - Multi-shop isolation
 *   - getState: returns correct state
 *   - getStats: returns all shops
 *   - reset/resetAll: clears state
 *   - Circuit breaker: threshold, open state, half_open probe, recovery
 *   - Circuit breaker: per-shop isolation, getHealth, getCircuitState
 *   - persistState: Redis→DB fallback when Redis unavailable
 *   - Schema validation: corrupted data from DB rejected
 *   - evictOldest: MAX_SHOPS limit triggers LRU eviction
 *   - getMetrics: counter accuracy (requests, 429s, delays, CB trips, reset)
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { shopifyRateLimiter } from "~/services/shopify-rate-limiter";

// Mock logger to verify warnings
vi.mock("~/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock ioredis to prevent Redis connection attempts in tests
vi.mock("ioredis", () => ({
  default: vi.fn(() => {
    throw new Error("Redis not available in tests");
  }),
}));

// Mock prisma to prevent real DB calls and enable call verification
vi.mock("~/db.server", () => ({
  default: {
    rateLimitCache: {
      upsert: vi.fn().mockResolvedValue(undefined),
      findUnique: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  },
}));

describe("ShopifyRateLimiter", () => {
  beforeEach(async () => {
    await shopifyRateLimiter.resetAll();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // parseLimitHeader
  // ─────────────────────────────────────────────────────────────────────────

  describe("parseLimitHeader", () => {
    it("should parse valid header format", () => {
      const result = shopifyRateLimiter.parseLimitHeader("42/1000");
      expect(result).toEqual({ used: 42, capacity: 1000 });
    });

    it("should parse header with different values", () => {
      const result = shopifyRateLimiter.parseLimitHeader("850/1000");
      expect(result).toEqual({ used: 850, capacity: 1000 });
    });

    it("should return null for null header", () => {
      const result = shopifyRateLimiter.parseLimitHeader(null);
      expect(result).toBeNull();
    });

    it("should return null for invalid format", () => {
      const result = shopifyRateLimiter.parseLimitHeader("invalid");
      expect(result).toBeNull();
    });

    it("should return null for malformed format", () => {
      const result = shopifyRateLimiter.parseLimitHeader("42-1000");
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // track
  // ─────────────────────────────────────────────────────────────────────────

  describe("track", () => {
    it("should update state from response headers", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "100/1000" },
      });

      shopifyRateLimiter.track("test.myshopify.com", response);

      const state = await shopifyRateLimiter.getState("test.myshopify.com");
      expect(state).not.toBeNull();
      expect(state?.used).toBe(100);
      expect(state?.capacity).toBe(1000);
      expect(state?.usagePercent).toBe(10);
      expect(state?.zone).toBe("green");
    });

    it("should ignore response without rate limit header", async () => {
      const response = new Response(null, { headers: {} });

      shopifyRateLimiter.track("test.myshopify.com", response);

      const state = await shopifyRateLimiter.getState("test.myshopify.com");
      expect(state).toBeNull();
    });

    it("should track multiple shops independently", async () => {
      const response1 = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "100/1000" },
      });
      const response2 = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "900/1000" },
      });

      shopifyRateLimiter.track("shop1.myshopify.com", response1);
      shopifyRateLimiter.track("shop2.myshopify.com", response2);

      const state1 = await shopifyRateLimiter.getState("shop1.myshopify.com");
      const state2 = await shopifyRateLimiter.getState("shop2.myshopify.com");

      expect(state1?.used).toBe(100);
      expect(state1?.zone).toBe("green");
      expect(state2?.used).toBe(900);
      expect(state2?.zone).toBe("red");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Zone calculation
  // ─────────────────────────────────────────────────────────────────────────

  describe("zone calculation", () => {
    it("should be green zone below 60%", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "500/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      const start = Date.now();
      await shopifyRateLimiter.acquire("test.myshopify.com");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
      const state = await shopifyRateLimiter.getState("test.myshopify.com");
      expect(state?.zone).toBe("green");
      expect(state?.delayMs).toBe(0);
    });

    it("should be yellow zone at 60-80%", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "700/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      const start = Date.now();
      await shopifyRateLimiter.acquire("test.myshopify.com");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(150);
      const state = await shopifyRateLimiter.getState("test.myshopify.com");
      expect(state?.zone).toBe("yellow");
      expect(state?.delayMs).toBe(50);
    });

    it("should be orange zone at 80-90%", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "850/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      const start = Date.now();
      await shopifyRateLimiter.acquire("test.myshopify.com");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(250);
      expect(elapsed).toBeLessThan(550);
      const state = await shopifyRateLimiter.getState("test.myshopify.com");
      expect(state?.delayMs).toBeGreaterThan(0);
      expect(["orange", "yellow"]).toContain(state?.zone);
    });

    it("should be red zone above 90%", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "950/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      const start = Date.now();
      await shopifyRateLimiter.acquire("test.myshopify.com");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(1000);
      expect(elapsed).toBeLessThan(1400);
      const state = await shopifyRateLimiter.getState("test.myshopify.com");
      expect(state?.delayMs).toBeGreaterThan(0);
      expect(["orange", "red"]).toContain(state?.zone);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // handle429
  // ─────────────────────────────────────────────────────────────────────────

  describe("handle429", () => {
    it("should set blockedUntil from Retry-After header", async () => {
      const response = new Response(null, {
        headers: {
          "X-Shopify-Shop-Api-Call-Limit": "1000/1000",
          "Retry-After": "3",
        },
      });

      // track() first (simulates _core.ts call order)
      shopifyRateLimiter.track("test.myshopify.com", response);
      shopifyRateLimiter.handle429("test.myshopify.com", response);

      const state = await shopifyRateLimiter.getState("test.myshopify.com");
      expect(state).not.toBeNull();
      expect(state?.blockedUntil).toBeGreaterThan(Date.now());
      expect(state?.blockedUntil).toBeLessThanOrEqual(Date.now() + 3500);
    });

    it("should default to 2s when Retry-After missing", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "1000/1000" },
      });

      shopifyRateLimiter.track("test.myshopify.com", response);
      shopifyRateLimiter.handle429("test.myshopify.com", response);

      const state = await shopifyRateLimiter.getState("test.myshopify.com");
      expect(state?.blockedUntil).toBeGreaterThan(Date.now());
      expect(state?.blockedUntil).toBeLessThanOrEqual(Date.now() + 2500);
    });

    it("should block acquire until blockedUntil", async () => {
      const response = new Response(null, {
        headers: {
          "X-Shopify-Shop-Api-Call-Limit": "1000/1000",
          "Retry-After": "1",
        },
      });

      shopifyRateLimiter.track("test.myshopify.com", response);
      shopifyRateLimiter.handle429("test.myshopify.com", response);

      const start = Date.now();
      await shopifyRateLimiter.acquire("test.myshopify.com");
      shopifyRateLimiter.release("test.myshopify.com");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(950);
      expect(elapsed).toBeLessThan(1200);
    });

    it("should preserve used/capacity from preceding track() call", async () => {
      const trackResponse = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "950/1000" },
      });
      const errorResponse = new Response(null, {
        headers: {
          "X-Shopify-Shop-Api-Call-Limit": "1000/1000",
          "Retry-After": "2",
        },
      });

      shopifyRateLimiter.track("test.myshopify.com", trackResponse);
      shopifyRateLimiter.handle429("test.myshopify.com", errorResponse);

      const state = await shopifyRateLimiter.getState("test.myshopify.com");
      // Should preserve the track() value (950), not overwrite with capacity (1000)
      expect(state?.used).toBe(950);
      expect(state?.capacity).toBe(1000);
      expect(state?.blockedUntil).toBeGreaterThan(Date.now());
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Priority
  // ─────────────────────────────────────────────────────────────────────────

  describe("priority", () => {
    it("should skip yellow zone delay for critical priority", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "700/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      const start = Date.now();
      await shopifyRateLimiter.acquire("test.myshopify.com", "critical");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it("should not skip orange/red zone delay for critical priority", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "850/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      const start = Date.now();
      await shopifyRateLimiter.acquire("test.myshopify.com", "critical");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(350);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // getState and getStats
  // ─────────────────────────────────────────────────────────────────────────

  describe("getState and getStats", () => {
    it("should return null for unknown shop", async () => {
      const state = await shopifyRateLimiter.getState("unknown.myshopify.com");
      expect(state).toBeNull();
    });

    it("should return correct state shape", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "500/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      const state = await shopifyRateLimiter.getState("test.myshopify.com");
      expect(state).toHaveProperty("used");
      expect(state).toHaveProperty("capacity");
      expect(state).toHaveProperty("usagePercent");
      expect(state).toHaveProperty("zone");
      expect(state).toHaveProperty("delayMs");
      expect(state).toHaveProperty("lastUpdate");
      expect(state).toHaveProperty("blockedUntil");
    });

    it("should return stats for all tracked shops", async () => {
      const response1 = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "100/1000" },
      });
      const response2 = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "900/1000" },
      });

      shopifyRateLimiter.track("shop1.myshopify.com", response1);
      shopifyRateLimiter.track("shop2.myshopify.com", response2);

      const stats = await shopifyRateLimiter.getStats();
      expect(Object.keys(stats)).toHaveLength(2);
      expect(stats["shop1.myshopify.com"]).toBeDefined();
      expect(stats["shop2.myshopify.com"]).toBeDefined();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // reset
  // ─────────────────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("should reset state for specific shop", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "500/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      expect(await shopifyRateLimiter.getState("test.myshopify.com")).not.toBeNull();

      await shopifyRateLimiter.reset("test.myshopify.com");

      expect(await shopifyRateLimiter.getState("test.myshopify.com")).toBeNull();
    });

    it("should reset all state", async () => {
      const response1 = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "100/1000" },
      });
      const response2 = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "900/1000" },
      });

      shopifyRateLimiter.track("shop1.myshopify.com", response1);
      shopifyRateLimiter.track("shop2.myshopify.com", response2);

      expect(Object.keys(await shopifyRateLimiter.getStats())).toHaveLength(2);

      await shopifyRateLimiter.resetAll();

      expect(Object.keys(await shopifyRateLimiter.getStats())).toHaveLength(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // acquire with no state
  // ─────────────────────────────────────────────────────────────────────────

  describe("acquire with no state", () => {
    it("should not delay when no state exists", async () => {
      const start = Date.now();
      await shopifyRateLimiter.acquire("unknown.myshopify.com");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Bucket refill decay
  // ─────────────────────────────────────────────────────────────────────────

  describe("bucket refill decay", () => {
    it("should skip delay when state is stale (>30s old)", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "950/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      // Manually age the state to simulate idle time
      const state = (shopifyRateLimiter as any).states.get("test.myshopify.com");
      state.lastUpdate = Date.now() - 31_000;

      const start = Date.now();
      await shopifyRateLimiter.acquire("test.myshopify.com");
      shopifyRateLimiter.release("test.myshopify.com");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(50);
    });

    it("should estimate lower usage after idle time", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "800/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      // Age state by 10 seconds → 500 calls refilled (10 * 50/sec)
      const state = (shopifyRateLimiter as any).states.get("test.myshopify.com");
      state.lastUpdate = Date.now() - 10_000;

      const estimated = await shopifyRateLimiter.getState("test.myshopify.com");
      // 800 - 500 = 300, usagePercent = 30% → green zone
      expect(estimated?.used).toBe(300);
      expect(estimated?.zone).toBe("green");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // release and inFlight tracking
  // ─────────────────────────────────────────────────────────────────────────

  describe("release and inFlight", () => {
    it("should increment inFlight on acquire and decrement on release", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "100/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      await shopifyRateLimiter.acquire("test.myshopify.com");
      const internalState = (shopifyRateLimiter as any).states.get("test.myshopify.com");
      expect(internalState.inFlight).toBe(1);

      shopifyRateLimiter.release("test.myshopify.com");
      expect(internalState.inFlight).toBe(0);
    });

    it("should not go below 0 on release", () => {
      shopifyRateLimiter.release("test.myshopify.com");
      const state = (shopifyRateLimiter as any).states.get("test.myshopify.com");
      expect(state).toBeUndefined();
    });

    it("should account for inFlight in estimated usage", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "500/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      await shopifyRateLimiter.acquire("test.myshopify.com");
      const estimated = await shopifyRateLimiter.getState("test.myshopify.com");
      // 500 used + 1 inFlight = 501 estimated
      expect(estimated?.used).toBe(501);

      shopifyRateLimiter.release("test.myshopify.com");
    });

    it("should decrement inFlight in track() when response arrives", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "100/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response);

      await shopifyRateLimiter.acquire("test.myshopify.com");
      const states = (shopifyRateLimiter as any).states;
      expect(states.get("test.myshopify.com").inFlight).toBe(1);

      // Simulate response arriving — track decrements inFlight
      const response2 = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "101/1000" },
      });
      shopifyRateLimiter.track("test.myshopify.com", response2);
      expect(states.get("test.myshopify.com").inFlight).toBe(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Circuit Breaker
  // ─────────────────────────────────────────────────────────────────────────

  describe("circuit breaker", () => {
    const SHOP = "cb-test.myshopify.com";

    function make429Response(retryAfter = "1"): Response {
      return new Response(null, {
        headers: {
          "X-Shopify-Shop-Api-Call-Limit": "1000/1000",
          "Retry-After": retryAfter,
        },
      });
    }

    it("should start in closed state with zero counter", () => {
      const circuit = shopifyRateLimiter.getCircuitState(SHOP);
      expect(circuit.state).toBe("closed");
      expect(circuit.consecutive429s).toBe(0);
      expect(circuit.openedAt).toBe(0);
    });

    it("should increment counter on each 429", () => {
      const resp = make429Response();
      for (let i = 0; i < 3; i++) {
        shopifyRateLimiter.handle429(SHOP, resp);
      }
      const circuit = shopifyRateLimiter.getCircuitState(SHOP);
      expect(circuit.consecutive429s).toBe(3);
      expect(circuit.state).toBe("closed");
    });

    it("should open circuit after 5 consecutive 429s", () => {
      const resp = make429Response();
      for (let i = 0; i < 5; i++) {
        shopifyRateLimiter.handle429(SHOP, resp);
      }
      const circuit = shopifyRateLimiter.getCircuitState(SHOP);
      expect(circuit.state).toBe("open");
      expect(circuit.consecutive429s).toBe(5);
      expect(circuit.openedAt).toBeGreaterThan(0);
    });

    it("should block acquire() when circuit is open", async () => {
      const resp = make429Response();
      for (let i = 0; i < 5; i++) {
        shopifyRateLimiter.handle429(SHOP, resp);
      }

      await expect(shopifyRateLimiter.acquire(SHOP)).rejects.toThrow(/Circuit breaker OPEN/);
    });

    it("should include remaining cooldown in error message", async () => {
      const resp = make429Response();
      for (let i = 0; i < 5; i++) {
        shopifyRateLimiter.handle429(SHOP, resp);
      }

      try {
        await shopifyRateLimiter.acquire(SHOP);
        expect.unreachable("should have thrown");
      } catch (err: unknown) {
        const message = (err as Error).message;
        expect(message).toMatch(/Cooldown \d+s remaining/);
      }
    });

    it("should transition to half_open after cooldown expires", async () => {
      const resp = make429Response();
      for (let i = 0; i < 5; i++) {
        shopifyRateLimiter.handle429(SHOP, resp);
      }

      // Manually age the openedAt to simulate cooldown expiry
      const circuit = (shopifyRateLimiter as any).circuits.get(SHOP);
      circuit.openedAt = Date.now() - 31_000;

      // acquire should succeed (transitions to half_open)
      await shopifyRateLimiter.acquire(SHOP);
      shopifyRateLimiter.release(SHOP);

      const updated = shopifyRateLimiter.getCircuitState(SHOP);
      expect(updated.state).toBe("half_open");
    });

    it("should close circuit on recordSuccess after half_open probe", async () => {
      const resp = make429Response();
      for (let i = 0; i < 5; i++) {
        shopifyRateLimiter.handle429(SHOP, resp);
      }

      // Age cooldown to allow probe
      const circuit = (shopifyRateLimiter as any).circuits.get(SHOP);
      circuit.openedAt = Date.now() - 31_000;

      await shopifyRateLimiter.acquire(SHOP);
      shopifyRateLimiter.release(SHOP);
      expect(shopifyRateLimiter.getCircuitState(SHOP).state).toBe("half_open");

      // Probe succeeds
      shopifyRateLimiter.recordSuccess(SHOP);
      const final = shopifyRateLimiter.getCircuitState(SHOP);
      expect(final.state).toBe("closed");
      expect(final.consecutive429s).toBe(0);
    });

    it("should re-open circuit on 429 during half_open", async () => {
      const resp = make429Response();
      for (let i = 0; i < 5; i++) {
        shopifyRateLimiter.handle429(SHOP, resp);
      }

      // Age cooldown to allow probe
      const circuit = (shopifyRateLimiter as any).circuits.get(SHOP);
      circuit.openedAt = Date.now() - 31_000;

      await shopifyRateLimiter.acquire(SHOP);
      shopifyRateLimiter.release(SHOP);
      expect(shopifyRateLimiter.getCircuitState(SHOP).state).toBe("half_open");

      // Probe fails — another 429
      shopifyRateLimiter.handle429(SHOP, make429Response());
      const reopened = shopifyRateLimiter.getCircuitState(SHOP);
      expect(reopened.state).toBe("open");
    });

    it("should reset counter on recordSuccess in closed state", () => {
      const resp = make429Response();
      // 3 consecutive 429s (below threshold)
      for (let i = 0; i < 3; i++) {
        shopifyRateLimiter.handle429(SHOP, resp);
      }
      expect(shopifyRateLimiter.getCircuitState(SHOP).consecutive429s).toBe(3);

      // Success resets counter
      shopifyRateLimiter.recordSuccess(SHOP);
      expect(shopifyRateLimiter.getCircuitState(SHOP).consecutive429s).toBe(0);
      expect(shopifyRateLimiter.getCircuitState(SHOP).state).toBe("closed");
    });

    it("should reset counter when 429s are outside the time window", () => {
      const resp = make429Response();
      // 3 consecutive 429s
      for (let i = 0; i < 3; i++) {
        shopifyRateLimiter.handle429(SHOP, resp);
      }

      // Age last429At outside the window
      const circuit = (shopifyRateLimiter as any).circuits.get(SHOP);
      circuit.last429At = Date.now() - 61_000;

      // Next 429 should start counter from 1 (window expired)
      shopifyRateLimiter.handle429(SHOP, resp);
      expect(shopifyRateLimiter.getCircuitState(SHOP).consecutive429s).toBe(1);
    });

    it("should isolate circuits per shop", () => {
      const shop1 = "shop1-cb.myshopify.com";
      const shop2 = "shop2-cb.myshopify.com";
      const resp = make429Response();

      // Open circuit for shop1 only
      for (let i = 0; i < 5; i++) {
        shopifyRateLimiter.handle429(shop1, resp);
      }

      expect(shopifyRateLimiter.getCircuitState(shop1).state).toBe("open");
      expect(shopifyRateLimiter.getCircuitState(shop2).state).toBe("closed");
    });

    it("getHealth should return combined rate limit + circuit state", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "500/1000" },
      });
      shopifyRateLimiter.track(SHOP, response);
      shopifyRateLimiter.handle429(SHOP, make429Response());

      const health = await shopifyRateLimiter.getHealth(SHOP);
      expect(health.rateLimit).not.toBeNull();
      expect(health.rateLimit?.capacity).toBe(1000);
      expect(health.circuit.state).toBe("closed");
      expect(health.circuit.consecutive429s).toBe(1);
    });

    it("getHealth should return default circuit for unknown shop", async () => {
      const health = await shopifyRateLimiter.getHealth("unknown-cb.myshopify.com");
      expect(health.rateLimit).toBeNull();
      expect(health.circuit.state).toBe("closed");
      expect(health.circuit.consecutive429s).toBe(0);
    });

    it("reset should clear circuit state", async () => {
      const resp = make429Response();
      for (let i = 0; i < 5; i++) {
        shopifyRateLimiter.handle429(SHOP, resp);
      }
      expect(shopifyRateLimiter.getCircuitState(SHOP).state).toBe("open");

      await shopifyRateLimiter.reset(SHOP);
      expect(shopifyRateLimiter.getCircuitState(SHOP).state).toBe("closed");
      expect(shopifyRateLimiter.getCircuitState(SHOP).consecutive429s).toBe(0);
    });

    it("resetAll should clear all circuit states", async () => {
      const resp = make429Response();
      for (let i = 0; i < 5; i++) {
        shopifyRateLimiter.handle429("shop-a.myshopify.com", resp);
        shopifyRateLimiter.handle429("shop-b.myshopify.com", resp);
      }

      expect(shopifyRateLimiter.getCircuitState("shop-a.myshopify.com").state).toBe("open");
      expect(shopifyRateLimiter.getCircuitState("shop-b.myshopify.com").state).toBe("open");

      await shopifyRateLimiter.resetAll();

      expect(shopifyRateLimiter.getCircuitState("shop-a.myshopify.com").state).toBe("closed");
      expect(shopifyRateLimiter.getCircuitState("shop-b.myshopify.com").state).toBe("closed");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Optimization 1: persistState (Redis→DB fallback)
  // ─────────────────────────────────────────────────────────────────────────

  describe("persistState (Redis→DB fallback)", () => {
    it("should not dual-write (exactly one persist call per track)", async () => {
      const prisma = (await import("~/db.server")).default;
      const mockUpsert = vi.mocked(prisma.rateLimitCache.upsert).mockClear();

      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "500/1000" },
      });
      shopifyRateLimiter.track("no-dual-write.myshopify.com", response);

      await new Promise((r) => setTimeout(r, 50));

      // persistState should write exactly once — not dual-write to both Redis and DB
      // (In test env Redis is unavailable, so the single write goes to DB)
      expect(mockUpsert).toHaveBeenCalledTimes(1);
    });

    it("should fall back to DB when Redis is unavailable", async () => {
      const prisma = (await import("~/db.server")).default;
      const mockUpsert = vi.mocked(prisma.rateLimitCache.upsert).mockClear();

      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "500/1000" },
      });
      shopifyRateLimiter.track("fallback-test.myshopify.com", response);

      // Wait for fire-and-forget persistState to complete
      await new Promise((r) => setTimeout(r, 50));

      // Since Redis is unavailable in tests, persistState should write to DB
      expect(mockUpsert).toHaveBeenCalled();
      const callArgs = mockUpsert.mock.calls[0][0];
      expect(callArgs.where.shopDomain).toBe("fallback-test.myshopify.com");
      expect(callArgs.create.state).toContain('"used":500');
    });

    it("should write to DB on handle429 when Redis is unavailable", async () => {
      const prisma = (await import("~/db.server")).default;
      const mockUpsert = vi.mocked(prisma.rateLimitCache.upsert).mockClear();

      const response = new Response(null, {
        headers: {
          "X-Shopify-Shop-Api-Call-Limit": "1000/1000",
          "Retry-After": "2",
        },
      });
      shopifyRateLimiter.track("h429-db-test.myshopify.com", response);
      shopifyRateLimiter.handle429("h429-db-test.myshopify.com", response);

      await new Promise((r) => setTimeout(r, 50));

      // handle429 should also persist to DB
      expect(mockUpsert).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Optimization 2: Schema validation on corrupted data
  // ─────────────────────────────────────────────────────────────────────────

  describe("schema validation on remote data", () => {
    it("should reject corrupted data from DB in syncFromRemote", async () => {
      const prisma = (await import("~/db.server")).default;
      const mockFindUnique = vi.mocked(prisma.rateLimitCache.findUnique);

      // Mock DB returning corrupted data (missing required fields)
      mockFindUnique.mockResolvedValueOnce({
        shopDomain: "corrupt.myshopify.com",
        state: JSON.stringify({ foo: "bar" }), // invalid schema
        expiresAt: new Date(Date.now() + 300_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      // acquire triggers syncFromRemote
      await shopifyRateLimiter.acquire("corrupt.myshopify.com");

      // Corrupted data should be rejected — no state stored
      const state = await shopifyRateLimiter.getState("corrupt.myshopify.com");
      // State should be null (corrupted data rejected, no in-memory state)
      expect(state).toBeNull();
    });

    it("should reject non-numeric used field from DB", async () => {
      const prisma = (await import("~/db.server")).default;
      const mockFindUnique = vi.mocked(prisma.rateLimitCache.findUnique);

      mockFindUnique.mockResolvedValueOnce({
        shopDomain: "bad-type.myshopify.com",
        state: JSON.stringify({ used: "not-a-number", capacity: 1000, lastUpdate: Date.now(), blockedUntil: 0 }),
        expiresAt: new Date(Date.now() + 300_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      await shopifyRateLimiter.acquire("bad-type.myshopify.com");
      const state = await shopifyRateLimiter.getState("bad-type.myshopify.com");
      expect(state).toBeNull();
    });

    it("should accept valid DB data with correct schema", async () => {
      const prisma = (await import("~/db.server")).default;
      const mockFindUnique = vi.mocked(prisma.rateLimitCache.findUnique);

      const validState = { used: 300, capacity: 1000, lastUpdate: Date.now(), blockedUntil: 0 };
      mockFindUnique.mockResolvedValueOnce({
        shopDomain: "valid-db.myshopify.com",
        state: JSON.stringify(validState),
        expiresAt: new Date(Date.now() + 300_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);

      await shopifyRateLimiter.acquire("valid-db.myshopify.com");

      // Valid DB data should be loaded into memory
      const state = await shopifyRateLimiter.getState("valid-db.myshopify.com");
      expect(state).not.toBeNull();
      expect(state?.capacity).toBe(1000);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Optimization 2: evictOldest (MAX_SHOPS)
  // ─────────────────────────────────────────────────────────────────────────

  describe("evictOldest (MAX_SHOPS)", () => {
    it("should evict the oldest shop when MAX_SHOPS is exceeded", async () => {
      const OriginalTracker = (shopifyRateLimiter as any).constructor;
      const originalMax = OriginalTracker.MAX_SHOPS;

      // Lower the limit for testing
      OriginalTracker.MAX_SHOPS = 3;

      try {
        const now = Date.now();

        // Add 3 shops with different timestamps
        for (const shop of ["oldest.myshopify.com", "middle.myshopify.com", "newest.myshopify.com"]) {
          const response = new Response(null, {
            headers: { "X-Shopify-Shop-Api-Call-Limit": "100/1000" },
          });
          shopifyRateLimiter.track(shop, response);
        }

        // Manually set timestamps to control eviction order
        const states = (shopifyRateLimiter as any).states;
        states.get("oldest.myshopify.com").lastUpdate = now - 3000;
        states.get("middle.myshopify.com").lastUpdate = now - 2000;
        states.get("newest.myshopify.com").lastUpdate = now - 1000;

        // Add a 4th shop — should trigger eviction of the oldest
        const response4 = new Response(null, {
          headers: { "X-Shopify-Shop-Api-Call-Limit": "200/1000" },
        });
        shopifyRateLimiter.track("fourth.myshopify.com", response4);

        // The oldest shop should have been evicted
        expect(states.has("oldest.myshopify.com")).toBe(false);
        expect(states.has("middle.myshopify.com")).toBe(true);
        expect(states.has("newest.myshopify.com")).toBe(true);
        expect(states.has("fourth.myshopify.com")).toBe(true);
        expect(states.size).toBe(3);
      } finally {
        OriginalTracker.MAX_SHOPS = originalMax;
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Optimization 2: getMetrics counter verification
  // ─────────────────────────────────────────────────────────────────────────

  describe("getMetrics", () => {
    it("should start with zero counters", () => {
      const metrics = shopifyRateLimiter.getMetrics();
      expect(metrics.totalRequests).toBe(0);
      expect(metrics.total429s).toBe(0);
      expect(metrics.totalDelays).toBe(0);
      expect(metrics.totalDelayMs).toBe(0);
      expect(metrics.circuitBreakerTrips).toBe(0);
      expect(metrics.since).toBeGreaterThan(0);
    });

    it("should count totalRequests on each acquire", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "100/1000" },
      });
      shopifyRateLimiter.track("metrics-test.myshopify.com", response);

      await shopifyRateLimiter.acquire("metrics-test.myshopify.com");
      shopifyRateLimiter.release("metrics-test.myshopify.com");

      expect(shopifyRateLimiter.getMetrics().totalRequests).toBe(1);

      await shopifyRateLimiter.acquire("metrics-test.myshopify.com");
      shopifyRateLimiter.release("metrics-test.myshopify.com");

      expect(shopifyRateLimiter.getMetrics().totalRequests).toBe(2);
    });

    it("should count total429s on each handle429", () => {
      const response = new Response(null, {
        headers: {
          "X-Shopify-Shop-Api-Call-Limit": "1000/1000",
          "Retry-After": "1",
        },
      });

      shopifyRateLimiter.handle429("metrics-429.myshopify.com", response);
      expect(shopifyRateLimiter.getMetrics().total429s).toBe(1);

      shopifyRateLimiter.handle429("metrics-429.myshopify.com", response);
      expect(shopifyRateLimiter.getMetrics().total429s).toBe(2);
    });

    it("should count totalDelays and totalDelayMs when delay is applied", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "700/1000" }, // yellow zone → 50ms delay
      });
      shopifyRateLimiter.track("metrics-delay.myshopify.com", response);

      await shopifyRateLimiter.acquire("metrics-delay.myshopify.com");
      shopifyRateLimiter.release("metrics-delay.myshopify.com");

      const metrics = shopifyRateLimiter.getMetrics();
      expect(metrics.totalDelays).toBe(1);
      expect(metrics.totalDelayMs).toBeGreaterThan(0);
    });

    it("should count circuitBreakerTrips when circuit opens", () => {
      const resp = new Response(null, {
        headers: {
          "X-Shopify-Shop-Api-Call-Limit": "1000/1000",
          "Retry-After": "1",
        },
      });

      for (let i = 0; i < 5; i++) {
        shopifyRateLimiter.handle429("metrics-cb.myshopify.com", resp);
      }

      expect(shopifyRateLimiter.getMetrics().circuitBreakerTrips).toBe(1);
    });

    it("should return a copy (not a reference) of metrics", () => {
      const m1 = shopifyRateLimiter.getMetrics();
      const m2 = shopifyRateLimiter.getMetrics();
      expect(m1).toEqual(m2);
      expect(m1).not.toBe(m2); // different object references
    });

    it("should reset to zero after resetAll", async () => {
      const response = new Response(null, {
        headers: { "X-Shopify-Shop-Api-Call-Limit": "100/1000" },
      });
      shopifyRateLimiter.track("metrics-reset.myshopify.com", response);
      await shopifyRateLimiter.acquire("metrics-reset.myshopify.com");
      shopifyRateLimiter.release("metrics-reset.myshopify.com");

      expect(shopifyRateLimiter.getMetrics().totalRequests).toBeGreaterThan(0);

      await shopifyRateLimiter.resetAll();

      expect(shopifyRateLimiter.getMetrics().totalRequests).toBe(0);
      expect(shopifyRateLimiter.getMetrics().total429s).toBe(0);
      expect(shopifyRateLimiter.getMetrics().totalDelays).toBe(0);
    });
  });
});
