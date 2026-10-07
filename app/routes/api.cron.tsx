/**
 * File: routes/api.cron.tsx
 * Author: yuntongsoft
 * Date: 2026/10/07
 * Purpose: Cron endpoint for background job processing — webhook queue consumption,
 *          stale job cleanup, and other periodic maintenance tasks.
 *
 * Security: Requires X-Cron-Secret header matching CRON_SECRET env var.
 * This prevents unauthorized triggering of background jobs.
 *
 * Usage (from cron service or manual):
 *   POST /api/cron
 *   Headers: X-Cron-Secret: <CRON_SECRET>
 *
 * Response: { consumed: N, cleaned: M, stats: { pending, processing, ... } }
 *
 * Dependencies: webhook-queue, crypto
 */
import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";
import { createLogger } from "~/utils/logger";
import { consumeWebhookBatch, cleanupWebhookJobs, getQueueStats } from "~/services/webhook-queue";

const logger = createLogger({ module: "api.cron" });

/**
 * Timing-safe string comparison to prevent timing attacks on secret comparison.
 */
function timingSafeEqual(provided: string, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export const action = async ({ request }: ActionFunctionArgs) => {
  // Authenticate via shared secret header
  const cronSecret = process.env.CRON_SECRET || "";
  const providedSecret = request.headers.get("X-Cron-Secret") || "";

  if (!cronSecret || !timingSafeEqual(providedSecret, cronSecret)) {
    return json({ error: "Unauthorized" }, { status: 401 });
  }

  logger.info("Cron job started");

  // 1. Consume pending webhook jobs (drain backlog, recover crashed jobs)
  let consumeResult = { completed: 0, failed: 0, requeued: 0, leaseLost: 0 };
  try {
    consumeResult = await consumeWebhookBatch();
  } catch (error) {
    logger.error({ error: (error as Error).message }, "Webhook batch consumption failed");
  }

  // 2. Cleanup old completed/failed jobs (prevent unbounded table growth)
  // OPTIMIZATION: This runs on every cron invocation. For high-frequency cron (e.g., every minute),
  // consider splitting into a separate daily endpoint to avoid unnecessary DELETE queries.
  let cleaned = 0;
  try {
    cleaned = await cleanupWebhookJobs();
  } catch (error) {
    logger.error({ error: (error as Error).message }, "Webhook job cleanup failed");
  }

  // 3. Get current queue stats for monitoring
  let stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  try {
    stats = await getQueueStats();
  } catch (error) {
    logger.error({ error: (error as Error).message }, "Failed to get queue stats");
  }

  logger.info(
    {
      consumed: consumeResult.completed,
      failed: consumeResult.failed,
      requeued: consumeResult.requeued,
      cleaned,
      stats,
    },
    "Cron job completed"
  );

  return json({
    consumed: consumeResult.completed,
    failed: consumeResult.failed,
    requeued: consumeResult.requeued,
    leaseLost: consumeResult.leaseLost,
    cleaned,
    stats,
  });
};
