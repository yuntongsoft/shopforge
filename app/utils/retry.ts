/**
 * File: retry.ts
 * Author: yuntongsoft
 * Date: 2026/08/07
 * Purpose: Exponential backoff retry utility for flaky operations (API calls, DB queries)
 *
 * Dependencies: logger
 * Used by: shopify.service.ts, billing.service.ts
 *
 * Usage:
 *   import { withRetry } from "~/utils/retry";
 *   const result = await withRetry(() => fetchShopifyData(), { maxRetries: 3, label: "fetchShopify" });
 */
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "retry" });

/**
 * Execute an async function with exponential backoff retry
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    label?: string;
  } = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    label = "operation",
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt === maxRetries) {
        logger.error(
          { label, attempt: attempt + 1, maxRetries, error: lastError.message },
          `${label} failed after ${maxRetries + 1} attempts`
        );
        throw lastError;
      }

      // Exponential backoff: 1s, 2s, 4s, ... capped at maxDelayMs
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      // Random jitter ±25%
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      const sleepMs = Math.round(delay + jitter);

      logger.warn(
        { label, attempt: attempt + 1, maxRetries, delayMs: sleepMs, error: lastError.message },
        `${label} failed, retrying in ${sleepMs}ms`
      );

      await sleep(sleepMs);
    }
  }

  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
