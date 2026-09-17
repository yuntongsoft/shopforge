/**
 * Tests for env-validator.ts — environment variable validation
 *
 * Coverage:
 *   - validateEnv throws when required vars are missing
 *   - validateEnv passes when all required vars are set
 *   - getEnvIssues returns warnings for optional vars
 *   - ENCRYPTION_KEY length validation
 *   - APP_URL format validation
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("env-validator", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear all relevant env vars before each test
    delete process.env.SHOPIFY_API_KEY;
    delete process.env.SHOPIFY_API_SECRET;
    delete process.env.DATABASE_URL;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.RESEND_API_KEY;
    delete process.env.APP_URL;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it("should throw when all required vars are missing", async () => {
    const { validateEnv } = await import("~/utils/env-validator");
    expect(() => validateEnv()).toThrow("Missing required environment variables");
  });

  it("should pass when all required vars are set", async () => {
    process.env.SHOPIFY_API_KEY = "test-key";
    process.env.SHOPIFY_API_SECRET = "test-secret";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.ENCRYPTION_KEY = "a".repeat(64);

    const { validateEnv } = await import("~/utils/env-validator");
    expect(() => validateEnv()).not.toThrow();
  });

  it("should report ENCRYPTION_KEY too short", async () => {
    process.env.SHOPIFY_API_KEY = "test-key";
    process.env.SHOPIFY_API_SECRET = "test-secret";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.ENCRYPTION_KEY = "too-short";

    const { getEnvIssues } = await import("~/utils/env-validator");
    const issues = getEnvIssues();
    const keyIssue = issues.find((i) => i.variable === "ENCRYPTION_KEY");
    expect(keyIssue).toBeDefined();
    expect(keyIssue!.message).toContain("Too short");
  });

  it("should warn when RESEND_API_KEY is not set", async () => {
    process.env.SHOPIFY_API_KEY = "test-key";
    process.env.SHOPIFY_API_SECRET = "test-secret";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.ENCRYPTION_KEY = "a".repeat(64);

    const { getEnvIssues } = await import("~/utils/env-validator");
    const issues = getEnvIssues();
    const resendIssue = issues.find((i) => i.variable === "RESEND_API_KEY");
    expect(resendIssue).toBeDefined();
    expect(resendIssue!.severity).toBe("warning");
  });

  it("should warn when APP_URL doesn't start with http", async () => {
    process.env.SHOPIFY_API_KEY = "test-key";
    process.env.SHOPIFY_API_SECRET = "test-secret";
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.ENCRYPTION_KEY = "a".repeat(64);
    process.env.APP_URL = "not-a-url";

    const { getEnvIssues } = await import("~/utils/env-validator");
    const issues = getEnvIssues();
    const urlIssue = issues.find((i) => i.variable === "APP_URL");
    expect(urlIssue).toBeDefined();
    expect(urlIssue!.message).toContain("http");
  });
});
