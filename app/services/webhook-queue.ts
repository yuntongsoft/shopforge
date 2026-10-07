/**
 * File: services/webhook-queue.ts
 * Author: yuntongsoft
 * Date: 2026/10/07
 * Purpose: Async webhook job queue — resilient processing with CAS claim, lease recovery,
 *          heartbeat, dead-letter, and exponential backoff retry.
 *
 * Design motivation:
 *   Some webhook handlers (e.g. Shopify Admin API calls, batch DB operations) may exceed
 *   Shopify's ~5s webhook response timeout. The queue persists the job and returns 200
 *   immediately, then a background consumer processes it with full lifecycle management.
 *
 * Lifecycle:
 *   1. Route receives webhook → verify → enqueue (pending) → return 200
 *   2. setImmediate triggers instant consumption (low-latency normal path)
 *   3. Cron endpoint (/api/cron) drains backlog (crash recovery fallback)
 *   4. CAS atomic claim (pending → processing) with generation-based ownership
 *   5. Failed jobs retry up to MAX_ATTEMPTS with exponential backoff, then dead-letter
 *
 * Key difference from DealCraft's reference implementation:
 *   - dispatch() delegates to webhookRegistry.dispatchHandlers() instead of a hardcoded
 *     topic→processor switch statement. This makes the scaffold fully pluggable —
 *     developers register handlers via webhookRegistry.on() with { async: true }.
 *
 * Dependencies: prisma (WebhookJob table), webhook-registry (handler dispatch), logger
 * Used by: webhook-registry.ts (enqueueWebhook), cron routes (consume/cleanup)
 */
import prisma from "~/db.server";
import { createLogger } from "~/utils/logger";
import { getErrorMessage } from "~/utils/errors";
import { webhookRegistry } from "~/services/webhook-registry";

const logger = createLogger({ module: "webhook-queue" });

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum processing attempts before marking as failed (dead-letter) */
const MAX_ATTEMPTS = 3;
/** Maximum jobs per batch consumption (prevents cron from running too long) */
const BATCH_LIMIT = 20;
/** Processing lease duration — jobs not completed within this window can be reclaimed */
export const WEBHOOK_LEASE_MS = 5 * 60_000;
/** Heartbeat interval — renews all outstanding jobs to prevent premature lease expiry */
export const WEBHOOK_HEARTBEAT_MS = 60_000;
/** Retry backoff base (ms): Nth failure waits BASE * 2^(N-1) before re-queue */
const BACKOFF_BASE_MS = 30_000;

// ─────────────────────────────────────────────────────────────────────────────
// Concurrency guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Concurrency guard: prevents parallel batch consumption.
 *
 * LIMITATION: This is process-local only. If you run multiple app instances
 * (horizontal scaling), each instance has its own `consuming` flag. The CAS
 * claim (pending → processing with generation check) prevents duplicate
 * processing, but multiple instances may race to claim the same jobs.
 * For distributed locking, use Redis SETNX or a similar mechanism.
 */
let consuming = false;

/** Internal shape of a claimed job during batch consumption */
interface QueuedJob {
  id: string;
  topic: string;
  shopDomain: string;
  payload: unknown;
  webhookId: string | null;
  attempts: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Enqueue
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Persist a webhook job and trigger instant consumption.
 *
 * Idempotency: The @@unique([topic, shopDomain, webhookId]) constraint catches
 * duplicate events (Shopify retries when it doesn't receive a 200). P2002 errors
 * are silently ignored — this is the expected dedup path.
 *
 * Fallback: If enqueue itself fails (DB down), we fall back to synchronous
 * dispatch so the business logic still executes.
 *
 * @param topic - Shopify webhook topic (SCREAMING_SNAKE_CASE)
 * @param shopDomain - Shop domain (e.g. "mystore.myshopify.com")
 * @param payload - Webhook payload (will be JSON.stringify'd for storage)
 * @param webhookId - X-Shopify-Webhook-Id for idempotent dedup
 */
export async function enqueueWebhook(
  topic: string,
  shopDomain: string,
  payload: unknown,
  webhookId?: string
): Promise<void> {
  try {
    const job = await prisma.webhookJob.create({
      data: {
        topic,
        shopDomain,
        webhookId: webhookId || null,
        // Payload stored as JSON string for cross-DB compatibility (SQLite/PG/MySQL)
        payload: JSON.stringify(payload),
      },
    });
    logger.info({ jobId: job.id, topic, shopDomain, webhookId }, "Webhook job persisted");

    // Instant consumption via setImmediate — does not block the webhook response
    setImmediate(() => {
      consumeWebhookBatch(BATCH_LIMIT).catch((error) => {
        logger.error(
          { error: getErrorMessage(error) },
          "Immediate webhook job consumption failed"
        );
      });
    });
  } catch (error) {
    // Idempotent dedup: Shopify retries unacknowledged events with the same webhookId.
    // The unique constraint catches this — silently ignore P2002.
    if ((error as { code?: string }).code === "P2002") {
      logger.info(
        { topic, shopDomain, webhookId },
        "Duplicate webhook event ignored (idempotency)"
      );
      return;
    }

    // Enqueue failure fallback: execute synchronously so business logic is not lost
    logger.error(
      { error: getErrorMessage(error), topic, shopDomain },
      "Enqueue failed, falling back to synchronous execution"
    );
    await webhookRegistry.dispatchHandlers(topic, shopDomain, payload, webhookId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lease recovery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reclaim processing jobs whose lease has expired (crash / timeout recovery).
 *
 * Uses atomic updateMany (no preceding findMany) to avoid TOCTOU races when
 * multiple consumers or cron calls run concurrently. The two updateMany calls
 * operate on disjoint sets (attempts >= MAX vs < MAX) so they never conflict.
 *
 * Jobs that haven't exceeded MAX_ATTEMPTS are reset to pending for re-processing.
 * Jobs that have exceeded MAX_ATTEMPTS are marked as failed (dead-letter).
 *
 * @returns Count of requeued and failed jobs
 */
export async function recoverWebhookJobs(): Promise<{ requeued: number; failed: number }> {
  const expiredThreshold = new Date(Date.now() - WEBHOOK_LEASE_MS);

  const baseWhere = {
    status: "processing",
    updatedAt: { lte: expiredThreshold },
  };

  // Atomic: no findMany→updateMany gap. Each updateMany only touches rows
  // that currently match, so concurrent calls are safe (idempotent).
  const [failed, requeued] = await Promise.all([
    prisma.webhookJob.updateMany({
      where: { ...baseWhere, attempts: { gte: MAX_ATTEMPTS } },
      data: {
        status: "failed",
        lastError: "Processing lease expired after maximum attempts",
        processedAt: new Date(),
      },
    }),
    prisma.webhookJob.updateMany({
      where: { ...baseWhere, attempts: { lt: MAX_ATTEMPTS } },
      data: {
        status: "pending",
        lastError: "Processing lease expired; retry pending",
        retryAfter: null,
      },
    }),
  ]);

  if (requeued.count || failed.count) {
    logger.warn(
      { requeued: requeued.count, failed: failed.count },
      "Expired webhook jobs recovered"
    );
  }

  return { requeued: requeued.count, failed: failed.count };
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch consumption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Consume a batch of pending webhook jobs with CAS claim, heartbeat, and lease guard.
 *
 * Processing flow per job:
 *   1. CAS claim: pending → processing (atomic, generation-guarded via attempts)
 *   2. Pre-dispatch lease check: confirm still owned before executing
 *   3. Dispatch to registry handlers (delegates to webhookRegistry.dispatchHandlers)
 *   4. On success: mark completed
 *   5. On failure: retry (pending + exponential backoff) or dead-letter (failed)
 *
 * Heartbeat: All outstanding jobs are renewed every WEBHOOK_HEARTBEAT_MS to prevent
 * the lease recovery from reclaiming them while this batch is still processing.
 *
 * @param limit - Batch size (positive integer, max 200)
 */
export async function consumeWebhookBatch(limit: number = BATCH_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw new Error("Invalid webhook batch limit");
  }

  // Concurrency guard: only one batch consumer at a time.
  // Prevents cron + setImmediate from racing on the same pending jobs.
  if (consuming) {
    logger.debug("Batch consumption already in progress, skipping");
    return { completed: 0, failed: 0, requeued: 0, leaseLost: 0 };
  }
  consuming = true;

  try {
    return await consumeWebhookBatchInner(limit);
  } finally {
    consuming = false;
  }
}

async function consumeWebhookBatchInner(limit: number) {
  // Step 0: Recover any crashed/stuck jobs first
  const recovered = await recoverWebhookJobs();
  const summary = {
    completed: 0,
    failed: recovered.failed,
    requeued: recovered.requeued,
    leaseLost: 0,
  };

  // Step 1: CAS claim — atomically transition pending → processing
  const claimed = await prisma.$transaction(async (tx) => {
    const pending = await tx.webhookJob.findMany({
      where: {
        status: "pending",
        attempts: { lt: MAX_ATTEMPTS },
        OR: [{ retryAfter: null }, { retryAfter: { lte: new Date() } }],
      },
      orderBy: { createdAt: "asc" },
      take: limit,
      select: {
        id: true,
        topic: true,
        shopDomain: true,
        payload: true,
        webhookId: true,
        attempts: true,
      },
    });

    const claimedJobs: QueuedJob[] = [];
    for (const job of pending) {
      // CAS: only claim if still pending with same generation (attempts)
      const res = await tx.webhookJob.updateMany({
        where: { id: job.id, status: "pending", attempts: job.attempts },
        data: { status: "processing", attempts: { increment: 1 }, updatedAt: new Date() },
      });
      if (res.count === 1) {
        claimedJobs.push({
          id: job.id,
          topic: job.topic,
          shopDomain: job.shopDomain,
          // Parse JSON string payload back to object
          payload: safeJsonParse(job.payload),
          webhookId: job.webhookId,
          attempts: job.attempts + 1,
        });
      }
    }
    return claimedJobs;
  });

  if (claimed.length === 0) return summary;

  // Step 2: Set up batch-level heartbeat to renew all outstanding jobs
  const outstanding = new Map(claimed.map((job) => [job.id, job]));
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let heartbeatInFlight: Promise<void> | undefined;

  const scheduleHeartbeat = () => {
    heartbeatTimer = setTimeout(() => {
      heartbeatInFlight = (async () => {
        try {
          const owners = [...outstanding.values()].map(({ id, attempts }) => ({ id, attempts }));
          if (owners.length) {
            await prisma.webhookJob.updateMany({
              where: {
                status: "processing",
                updatedAt: { gt: new Date(Date.now() - WEBHOOK_LEASE_MS) },
                OR: owners,
              },
              data: { updatedAt: new Date() },
            });
          }
        } catch (error) {
          logger.error({ error: getErrorMessage(error) }, "Webhook lease heartbeat failed");
        } finally {
          if (!stopped) scheduleHeartbeat();
        }
      })();
    }, WEBHOOK_HEARTBEAT_MS);
    heartbeatTimer.unref(); // Don't keep process alive just for heartbeat
  };
  scheduleHeartbeat();

  // Step 3: Process each claimed job sequentially
  try {
    for (const job of claimed) {
      const owner = { id: job.id, status: "processing", attempts: job.attempts };
      const activeOwner = () => ({
        ...owner,
        updatedAt: { gt: new Date(Date.now() - WEBHOOK_LEASE_MS) },
      });

      try {
        // Pre-dispatch lease check: confirm we still own this job
        const lease = await prisma.webhookJob.updateMany({
          where: activeOwner(),
          data: { updatedAt: new Date() },
        });
        if (lease.count !== 1) {
          summary.leaseLost++;
          logger.warn(
            { jobId: job.id, attempts: job.attempts },
            "Webhook job lease lost before dispatch"
          );
          continue;
        }

        // Dispatch to registered handlers via the webhook registry
        // This replaces DealCraft's hardcoded topic→processor switch statement
        await webhookRegistry.dispatchHandlers(job.topic, job.shopDomain, job.payload, job.webhookId || undefined);

        // Mark as completed (with lease guard)
        const result = await prisma.webhookJob.updateMany({
          where: activeOwner(),
          data: { status: "completed", processedAt: new Date(), lastError: null },
        });
        if (result.count === 1) {
          summary.completed++;
          logger.info(
            { jobId: job.id, topic: job.topic, shopDomain: job.shopDomain, attempts: job.attempts },
            "Webhook job completed"
          );
        } else {
          summary.leaseLost++;
          logger.warn(
            { jobId: job.id, attempts: job.attempts },
            "Webhook job lease lost before completion"
          );
        }
      } catch (error) {
        summary.failed++;
        const errMsg = getErrorMessage(error);
        const nextStatus = job.attempts >= MAX_ATTEMPTS ? "failed" : "pending";
        const retryAfter = nextStatus === "pending"
          ? new Date(Date.now() + BACKOFF_BASE_MS * Math.pow(2, job.attempts - 1))
          : null;

        const result = await prisma.webhookJob.updateMany({
          where: activeOwner(),
          data: {
            status: nextStatus,
            lastError: errMsg.slice(0, 2000),
            retryAfter,
          },
        });

        logger.error(
          {
            jobId: job.id,
            topic: job.topic,
            shopDomain: job.shopDomain,
            attempts: job.attempts,
            error: errMsg,
            nextStatus,
            leaseOwned: result.count === 1,
          },
          "Webhook job failed"
        );
      } finally {
        outstanding.delete(job.id);
      }
    }
  } finally {
    stopped = true;
    clearTimeout(heartbeatTimer);
    await heartbeatInFlight;
  }

  return summary;
}

/**
 * Convenience wrapper — consume and return completed count only.
 * For full summary (failed, requeued, leaseLost), use consumeWebhookBatch().
 */
export async function consumeWebhookJobs(limit: number = BATCH_LIMIT): Promise<number> {
  return (await consumeWebhookBatch(limit)).completed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delete old completed/failed jobs to prevent unbounded table growth.
 * Recommended: call from a daily cron job.
 *
 * @returns Number of deleted records
 */
export async function cleanupWebhookJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const res = await prisma.webhookJob.deleteMany({
    where: {
      status: { in: ["completed", "failed"] },
      createdAt: { lt: cutoff },
    },
  });
  if (res.count > 0) {
    logger.info({ deleted: res.count }, "Old webhook jobs cleaned up");
  }
  return res.count;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queue statistics (for health checks and monitoring)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get current queue status counts — used by health check endpoint.
 * Returns pending, processing, completed, and failed job counts.
 */
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const [pending, processing, completed, failed] = await Promise.all([
    prisma.webhookJob.count({ where: { status: "pending" } }),
    prisma.webhookJob.count({ where: { status: "processing" } }),
    prisma.webhookJob.count({ where: { status: "completed" } }),
    prisma.webhookJob.count({ where: { status: "failed" } }),
  ]);
  return { pending, processing, completed, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dead-letter inspection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List failed (dead-letter) jobs for manual inspection.
 * Returns the most recent failures first, limited to `limit` entries (max 200).
 */
export async function getDeadLetters(limit: number = 50): Promise<
  Array<{
    id: string;
    topic: string;
    shopDomain: string;
    payload: string;
    attempts: number;
    lastError: string | null;
    createdAt: Date;
    processedAt: Date | null;
  }>
> {
  const clampedLimit = Math.min(Math.max(limit, 1), 200);
  return prisma.webhookJob.findMany({
    where: { status: "failed" },
    orderBy: { processedAt: "desc" },
    take: clampedLimit,
    select: {
      id: true,
      topic: true,
      shopDomain: true,
      payload: true,
      attempts: true,
      lastError: true,
      createdAt: true,
      processedAt: true,
    },
  });
}

/**
 * Retry a specific dead-letter job by resetting it to pending status.
 * Returns true if the job was found and reset, false if not found or not in failed state.
 *
 * IMPORTANT: attempts must be reset to 0 — the CAS claim query filters
 * `attempts < MAX_ATTEMPTS`, so without this reset the job would remain
 * pending forever (unreachable by any consumer).
 */
export async function retryDeadLetter(jobId: string): Promise<boolean> {
  const result = await prisma.webhookJob.updateMany({
    where: { id: jobId, status: "failed" },
    data: {
      status: "pending",
      attempts: 0,
      lastError: "Manually retried via dead-letter API",
      retryAfter: null,
      processedAt: null,
    },
  });
  if (result.count > 0) {
    logger.info({ jobId }, "Dead-letter job reset to pending for retry");
  }
  return result.count > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safe JSON parse — returns the original string as-is if parsing fails.
 * Payload is stored as String for cross-DB compatibility; this converts it back.
 */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Should never happen if enqueue always JSON.stringify's, but be defensive
    logger.warn({ rawLength: raw?.length }, "Failed to parse webhook job payload");
    return raw;
  }
}
