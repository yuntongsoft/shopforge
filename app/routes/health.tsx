/**
 * File: routes/health.tsx
 * Author: yuntongsoft
 * Date: 2026/09/03
 * Purpose: Health check endpoint — DB connectivity, env config, encryption, and shop stats.
 *          Use ?detail=1 for full diagnostics (env issues, shop count).
 *
 * Response:
 *   GET /health          → { status, version, timestamp, checks: { database } }
 *   GET /health?detail=1 → adds { env: [...], shops: { total }, encryption: "ok"|"fail" }
 */
import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import crypto from "crypto";
import prisma from "~/db.server";
import { getEnvIssues } from "~/utils/env-validator";
import { encrypt } from "~/utils/encryption";

/**
 * Timing-safe string comparison — prevents timing attacks on secret comparison.
 * Returns false if lengths differ (safe because attacker already knows the length).
 */
function timingSafeEqual(provided: string, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * Health check — basic mode is public, detail mode requires CRON_SECRET header.
 * This prevents exposing environment diagnostics to unauthenticated requests.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const detail = url.searchParams.get("detail") === "1";

  // Detail mode requires a shared secret via X-Cron-Secret header (set CRON_SECRET in env).
  // NOTE: Secret is ONLY accepted via header — never via URL query param to prevent
  // leakage in server logs, browser history, and referrer headers.
  if (detail) {
    const cronSecret = process.env.CRON_SECRET || "";
    const providedSecret = request.headers.get("X-Cron-Secret") || "";
    if (!cronSecret || !timingSafeEqual(providedSecret, cronSecret)) {
      return json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const checks: Record<string, string> = {};

  // 1. Database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch {
    checks.database = "fail";
  }

  const baseResult = {
    status: checks.database === "ok" ? "healthy" : "degraded",
    version: process.env.npm_package_version || "1.0.0",
    timestamp: new Date().toISOString(),
    checks,
  };

  // Short response for simple health checks
  if (!detail) {
    return json(baseResult, { status: checks.database === "ok" ? 200 : 503 });
  }

  // 2. Environment variable issues (detailed mode)
  const envIssues = getEnvIssues();

  // 3. Encryption key validation
  let encryptionStatus = "ok";
  try {
    const test = encrypt("health-check-test");
    if (!test) encryptionStatus = "fail";
  } catch {
    encryptionStatus = "fail";
  }

  // 4. Shop count
  let shopCount = 0;
  try {
    shopCount = await prisma.shop.count({ where: { isDeleted: false } });
  } catch {
    shopCount = -1; // -1 = error
  }

  return json(
    {
      ...baseResult,
      env: envIssues.map((i) => ({ variable: i.variable, severity: i.severity, message: i.message })),
      encryption: encryptionStatus,
      shops: { total: shopCount },
    },
    { status: checks.database === "ok" && encryptionStatus === "ok" ? 200 : 503 }
  );
};
