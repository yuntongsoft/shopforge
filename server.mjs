/**
 * File: server.mjs
 * Author: yuntongsoft
 * Date: 2026/08/24
 * Purpose: Production Express server — serves the Remix build
 *
 * Usage: node server.mjs
 * Requires: npm run build first
 */
import { createRequestHandler } from "@remix-run/express";
import express from "express";
import pino from "pino";

// Structured logger for Express middleware — matches the format used by app-level Pino loggers
const serverLogger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  ...(process.env.NODE_ENV !== "production" && {
    transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" } },
  }),
});

// Validate required env vars at startup — fail fast with clear messages
const REQUIRED_ENV = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "DATABASE_URL", "ENCRYPTION_KEY"];
const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`[env] Missing required variables: ${missing.join(", ")}`);
  console.error(`[env] Fix: Copy .env.example to .env and fill in the values.`);
  process.exit(1);
}

const app = express();

// Trust proxy (Nginx / Cloudflare) for correct HTTPS detection
app.set("trust proxy", true);

// Body size limits — prevent abuse from oversized payloads
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));

// Request logging middleware — structured Pino JSON for log aggregators
app.use((req, res, next) => {
  const start = Date.now();
  const traceId = req.headers["x-trace-id"] || "";
  res.on("finish", () => {
    const duration = Date.now() - start;
    serverLogger.info(
      { method: req.method, url: req.originalUrl, status: res.statusCode, duration_ms: duration, traceId },
      "request"
    );
  });
  next();
});

// Health check is handled by Remix route: app/routes/health.tsx
// It provides full diagnostics: DB connectivity, encryption, env validation.
// Basic: GET /health  |  Detailed: GET /health?detail=1 (requires X-Cron-Secret header)

// Serve Remix build
const build = await import("./build/server/index.js");
app.use(createRequestHandler({ build }));

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`ShopForge server running on port ${port}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Graceful shutdown — close HTTP server on SIGTERM/SIGINT
// ─────────────────────────────────────────────────────────────────────────────
// NOTE: The Prisma client singleton lives in db.server.ts (used by the Remix
// build). We do NOT create a second PrismaClient here — that would open a
// duplicate connection pool. When the process exits after server.close(),
// Node.js automatically terminates all remaining TCP connections including
// the Prisma pool.

async function shutdown(signal) {
  console.log(`[${signal}] Shutting down gracefully...`);
  server.close(() => {
    console.log("[shutdown] HTTP server closed");
    process.exit(0);
  });
  // Stop accepting new connections immediately
  server.closeAllConnections?.();
  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error("[shutdown] Forced exit after 10s timeout");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
