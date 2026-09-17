/**
 * Tests for csrf.ts — CSRF token generation and validation
 *
 * Coverage:
 *   - Token generation produces valid format (3 parts)
 *   - Valid token passes validation
 *   - Missing token throws
 *   - Malformed token throws
 *   - Tampered token throws (timing-safe comparison)
 *   - Different tokens are unique
 */
import { describe, it, expect } from "vitest";

process.env.CSRF_SECRET = "test-csrf-secret-for-testing-only";

import { generateCsrfToken, validateCsrfToken } from "~/utils/csrf";

describe("CSRF token", () => {
  it("should generate a token with 3 dot-separated parts", () => {
    const token = generateCsrfToken();
    const parts = token.split(".");
    expect(parts.length).toBe(3);
    // timestamp, random, signature
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBe(32); // 16 bytes hex
    expect(parts[2].length).toBe(64); // SHA-256 hex
  });

  it("should validate a freshly generated token", () => {
    const token = generateCsrfToken();
    expect(validateCsrfToken(token)).toBe(true);
  });

  it("should throw on null token", () => {
    expect(() => validateCsrfToken(null)).toThrow("CSRF token missing");
  });

  it("should throw on undefined token", () => {
    expect(() => validateCsrfToken(undefined)).toThrow("CSRF token missing");
  });

  it("should throw on malformed token (wrong number of parts)", () => {
    expect(() => validateCsrfToken("only.two")).toThrow("CSRF token malformed");
    expect(() => validateCsrfToken("one")).toThrow("CSRF token malformed");
  });

  it("should throw on tampered signature", () => {
    const token = generateCsrfToken();
    const parts = token.split(".");
    parts[2] = "f".repeat(64); // Replace signature
    expect(() => validateCsrfToken(parts.join("."))).toThrow("CSRF token invalid");
  });

  it("should throw on truncated signature (length mismatch, not RangeError)", () => {
    const token = generateCsrfToken();
    const parts = token.split(".");
    // Truncate the signature to a shorter length — should throw "CSRF token invalid"
    // not RangeError from timingSafeEqual
    parts[2] = "ab";
    expect(() => validateCsrfToken(parts.join("."))).toThrow("CSRF token invalid");
  });

  it("should generate unique tokens each time", () => {
    const tokens = new Set(Array.from({ length: 10 }, () => generateCsrfToken()));
    expect(tokens.size).toBe(10);
  });

  it("should throw when CSRF_SECRET is not set", () => {
    const original = process.env.CSRF_SECRET;
    const originalSession = process.env.SESSION_SECRET;
    delete process.env.CSRF_SECRET;
    delete process.env.SESSION_SECRET;
    expect(() => generateCsrfToken()).toThrow("CSRF_SECRET");
    process.env.CSRF_SECRET = original;
    process.env.SESSION_SECRET = originalSession;
  });
});
