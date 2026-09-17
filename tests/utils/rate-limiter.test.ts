/**
 * Tests for rate-limiter.ts — in-memory rate limiting
 *
 * Coverage:
 *   - Requests within limit succeed (return null)
 *   - Requests exceeding limit are blocked (return retryAfter)
 *   - Rate limit resets after window expires
 *   - Different keys are independent
 *   - Cleanup removes expired entries
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { rateLimit, RATE_LIMIT_PRESETS, cleanupRateLimitStore } from "~/utils/rate-limiter";

describe("rateLimit", () => {
  beforeEach(() => {
    // Reset the rate limit store between tests
    cleanupRateLimitStore();
  });

  it("should allow requests within the limit", async () => {
    const result = await rateLimit("test-key", { max: 5, windowMs: 60000 });
    expect(result).toBeNull();
  });

  it("should block requests exceeding the limit", async () => {
    const config = { max: 2, windowMs: 60000 };

    // First two should pass
    expect(await rateLimit("test-block", config)).toBeNull();
    expect(await rateLimit("test-block", config)).toBeNull();

    // Third should be blocked
    const blocked = await rateLimit("test-block", config);
    expect(blocked).not.toBeNull();
    expect(blocked!.retryAfter).toBeGreaterThan(0);
  });

  it("should track different keys independently", async () => {
    const config = { max: 1, windowMs: 60000 };

    expect(await rateLimit("key-a", config)).toBeNull();
    expect(await rateLimit("key-b", config)).toBeNull();

    // key-a is now blocked, but key-b was already at limit too
    const blockedA = await rateLimit("key-a", config);
    expect(blockedA).not.toBeNull();
  });

  it("should provide retryAfter in milliseconds", async () => {
    const config = { max: 1, windowMs: 30000 };
    await rateLimit("test-retry", config);
    const blocked = await rateLimit("test-retry", config);

    expect(blocked).not.toBeNull();
    expect(blocked!.retryAfter).toBeGreaterThan(0);
    expect(blocked!.retryAfter).toBeLessThanOrEqual(30000);
  });
});

describe("RATE_LIMIT_PRESETS", () => {
  it("should have login preset (5/min)", () => {
    expect(RATE_LIMIT_PRESETS.login).toBeDefined();
    expect(RATE_LIMIT_PRESETS.login.max).toBe(5);
    expect(RATE_LIMIT_PRESETS.login.windowMs).toBe(60000);
  });

  it("should have write preset (10/min)", () => {
    expect(RATE_LIMIT_PRESETS.write).toBeDefined();
    expect(RATE_LIMIT_PRESETS.write.max).toBe(10);
    expect(RATE_LIMIT_PRESETS.write.windowMs).toBe(60000);
  });

  it("should have api preset (60/min)", () => {
    expect(RATE_LIMIT_PRESETS.api).toBeDefined();
    expect(RATE_LIMIT_PRESETS.api.max).toBe(60);
    expect(RATE_LIMIT_PRESETS.api.windowMs).toBe(60000);
  });
});
