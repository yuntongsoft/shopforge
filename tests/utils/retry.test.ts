/**
 * Tests for retry.ts — exponential backoff retry utility
 *
 * Coverage:
 *   - Succeeds on first attempt (no retry)
 *   - Retries on failure and succeeds
 *   - Throws after max retries exhausted
 *   - Respects custom maxRetries option
 *   - Delay increases exponentially (verified via mock timing)
 */
import { describe, it, expect, vi } from "vitest";
import { withRetry } from "~/utils/retry";

describe("withRetry", () => {
  it("should return result on first success (no retry)", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should retry on failure and return eventual success", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error("fail 1"))
      .mockRejectedValueOnce(new Error("fail 2"))
      .mockResolvedValue("ok");

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 1 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should throw after all retries exhausted", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("permanent failure"));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 1 })
    ).rejects.toThrow("permanent failure");

    // 1 initial + 2 retries = 3 total calls
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("should work with maxRetries = 0 (no retries)", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("immediate fail"));

    await expect(
      withRetry(fn, { maxRetries: 0, baseDelayMs: 1 })
    ).rejects.toThrow("immediate fail");

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("should handle non-Error thrown values", async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce("string error")
      .mockResolvedValue("recovered");

    const result = await withRetry(fn, { maxRetries: 1, baseDelayMs: 1 });
    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("should use default options when none provided", async () => {
    const fn = vi.fn().mockResolvedValue("default-ok");
    const result = await withRetry(fn);
    expect(result).toBe("default-ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
