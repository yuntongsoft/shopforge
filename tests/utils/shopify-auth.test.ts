/**
 * Tests for shopify-auth.ts — SSRF prevention and session token validation
 *
 * Coverage:
 *   - isValidShopDomain: valid/invalid domains (SSRF prevention)
 *   - verifySessionToken: JWT signature verification (RS256 via JWKS)
 *   - Edge cases: empty strings, special chars, subdomains
 *
 * NOTE: verifySessionToken is now async and uses jwt.verify() with RS256
 * signature verification. Tests use fake JWTs that will fail at the
 * JWKS key fetch step (expected behavior — signature not verified).
 */
import { describe, it, expect } from "vitest";
import { isValidShopDomain, verifySessionToken } from "~/utils/shopify-auth";

describe("isValidShopDomain", () => {
  // Valid domains
  it("should accept standard myshopify.com domain", () => {
    expect(isValidShopDomain("example.myshopify.com")).toBe(true);
  });

  it("should accept domain with hyphens", () => {
    expect(isValidShopDomain("my-cool-store.myshopify.com")).toBe(true);
  });

  it("should accept domain with numbers", () => {
    expect(isValidShopDomain("store123.myshopify.com")).toBe(true);
  });

  // Invalid domains
  it("should reject empty string", () => {
    expect(isValidShopDomain("")).toBe(false);
  });

  it("should reject non-myshopify domain", () => {
    expect(isValidShopDomain("example.com")).toBe(false);
  });

  it("should reject domain with path", () => {
    expect(isValidShopDomain("example.myshopify.com/admin")).toBe(false);
  });

  it("should reject domain with protocol", () => {
    expect(isValidShopDomain("https://example.myshopify.com")).toBe(false);
  });

  it("should reject domain with port", () => {
    expect(isValidShopDomain("example.myshopify.com:443")).toBe(false);
  });

  it("should reject domain starting with hyphen", () => {
    expect(isValidShopDomain("-store.myshopify.com")).toBe(false);
  });

  it("should reject domain with spaces", () => {
    expect(isValidShopDomain("my store.myshopify.com")).toBe(false);
  });

  it("should reject domain with special characters", () => {
    expect(isValidShopDomain("store!.myshopify.com")).toBe(false);
  });

  it("should reject internal IP addresses (SSRF prevention)", () => {
    expect(isValidShopDomain("192.168.1.1")).toBe(false);
    expect(isValidShopDomain("10.0.0.1")).toBe(false);
    expect(isValidShopDomain("127.0.0.1")).toBe(false);
  });

  it("should reject localhost", () => {
    expect(isValidShopDomain("localhost")).toBe(false);
  });

  it("should accept domain with uppercase (regex is case-insensitive)", () => {
    expect(isValidShopDomain("Example.myshopify.com")).toBe(true);
  });
});

describe("verifySessionToken", () => {
  it("should throw for non-JWT string", async () => {
    await expect(verifySessionToken("not-a-jwt")).rejects.toThrow();
  });

  it("should throw for empty string", async () => {
    await expect(verifySessionToken("")).rejects.toThrow();
  });

  it("should throw for JWT with invalid structure (less than 3 parts)", async () => {
    await expect(verifySessionToken("part1.part2")).rejects.toThrow();
  });

  it("should throw for JWT with invalid issuer domain", async () => {
    // Create a JWT-like token with an invalid issuer (not a myshopify.com domain)
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test-kid" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: "https://evil.com/admin",
      aud: "test-api-key",
      exp: Math.floor(Date.now() / 1000) + 3600,
      dest: "https://evil.com",
      sub: "12345",
    })).toString("base64url");
    const fakeJwt = `${header}.${payload}.fake-signature`;

    // Should reject because the issuer domain is not a valid myshopify.com domain
    await expect(verifySessionToken(fakeJwt)).rejects.toThrow("Invalid token issuer");
  });

  it("should throw for JWT with missing kid in header", async () => {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" /* no kid */ })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: "https://test.myshopify.com/admin",
      aud: "test-api-key",
      exp: Math.floor(Date.now() / 1000) + 3600,
      dest: "https://test.myshopify.com",
      sub: "12345",
    })).toString("base64url");
    const fakeJwt = `${header}.${payload}.fake-signature`;

    await expect(verifySessionToken(fakeJwt)).rejects.toThrow("missing 'kid'");
  });
});
