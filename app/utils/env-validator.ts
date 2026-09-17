/**
 * File: utils/env-validator.ts
 * Author: yuntongsoft
 * Date: 2026/08/09
 * Purpose: Validate required environment variables at startup — fail fast with clear messages
 *          instead of cryptic runtime errors when a config is missing.
 *
 * Dependencies: none (pure validation)
 * Used by: server.mjs (on startup), health endpoint (on-demand check)
 *
 * Usage:
 *   import { validateEnv, getEnvIssues } from "~/utils/env-validator";
 *   // At startup — throws if critical vars are missing
 *   validateEnv();
 *   // On-demand — returns issues without throwing
 *   const issues = getEnvIssues();
 */

interface EnvIssue {
  variable: string;
  severity: "required" | "warning";
  message: string;
}

/**
 * Define required and optional env vars with validation rules.
 */
const ENV_RULES: Array<{
  variable: string;
  severity: "required" | "warning";
  validate: (value: string | undefined) => string | null; // returns error message or null
}> = [
  {
    variable: "SHOPIFY_API_KEY",
    severity: "required",
    validate: (v) => (!v ? "Missing — get it from Partner Dashboard" : null),
  },
  {
    variable: "SHOPIFY_API_SECRET",
    severity: "required",
    validate: (v) => (!v ? "Missing — get it from Partner Dashboard" : null),
  },
  {
    variable: "DATABASE_URL",
    severity: "required",
    validate: (v) => (!v ? "Missing — set PostgreSQL connection string" : null),
  },
  {
    variable: "ENCRYPTION_KEY",
    severity: "required",
    validate: (v) => {
      if (!v) return "Missing — generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"";
      if (v.length < 32) return `Too short (${v.length} chars) — must be at least 32 characters (64 hex = 32 bytes)`;
      return null;
    },
  },
  {
    variable: "RESEND_API_KEY",
    severity: "warning",
    validate: (v) => (!v ? "Not set — emails will be mocked in dev (logged, not sent)" : null),
  },
  {
    variable: "APP_URL",
    severity: "warning",
    validate: (v) => {
      if (!v) return "Not set — defaults to http://localhost:3000 (auto-detected by Shopify CLI in dev)";
      if (!v.startsWith("http")) return "Should start with http:// or https://";
      return null;
    },
  },
];

/**
 * Get all environment issues without throwing.
 * Useful for health check endpoints to report config status.
 */
export function getEnvIssues(): EnvIssue[] {
  const issues: EnvIssue[] = [];

  for (const rule of ENV_RULES) {
    const value = process.env[rule.variable];
    const error = rule.validate(value);
    if (error) {
      issues.push({ variable: rule.variable, severity: rule.severity, message: error });
    }
  }

  return issues;
}

/**
 * Validate environment variables at startup.
 * Throws an error if any REQUIRED variable is missing.
 * Logs warnings for optional variables but does not throw.
 *
 * Call this once at server startup to fail fast with clear messages.
 */
export function validateEnv(): void {
  const issues = getEnvIssues();
  const required = issues.filter((i) => i.severity === "required");
  const warnings = issues.filter((i) => i.severity === "warning");

  // Log warnings (non-blocking)
  for (const w of warnings) {
    console.warn(`[env] ⚠ ${w.variable}: ${w.message}`);
  }

  // Throw if required vars are missing
  if (required.length > 0) {
    const details = required.map((r) => `  • ${r.variable}: ${r.message}`).join("\n");
    throw new Error(
      `[env] Missing required environment variables:\n${details}\n\n` +
        `Fix: Copy .env.example to .env and fill in the values.`
    );
  }
}
