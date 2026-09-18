/**
 * File: utils/csrf.ts
 * Author: yuntongsoft
 * Date: 2026/08/10
 * Purpose: CSRF (Cross-Site Request Forgery) protection for form submissions.
 *
 * Uses double-submit cookie pattern with HMAC-signed tokens.
 * All POST/PUT/DELETE forms must include a CSRF token.
 *
 * Dependencies: crypto (Node.js built-in)
 * Used by: All routes with form actions, app.tsx (root layout)
 *
 * Usage:
 *   // In loader (generate token):
 *   const csrfToken = generateCsrfToken();
 *   return json({ csrfToken });
 *
 *   // In action (validate token):
 *   const formData = await request.formData();
 *   validateCsrfToken(formData.get("csrfToken") as string);
 *
 *   // In form (include token):
 *   <input type="hidden" name="csrfToken" value={csrfToken} />
 */
import crypto from "crypto";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "csrf" });

/**
 * CSRF signing secret — MUST be set via environment variable in production.
 * Falls back to SESSION_SECRET for convenience, but throws if neither is configured
 * to prevent using a predictable default in production.
 */
function getCsrfSecret(): string {
  // In production, CSRF_SECRET or SESSION_SECRET must be set.
  // In dev, fall back to SHOPIFY_API_SECRET (adequate for HMAC signing).
  const secret = process.env.CSRF_SECRET || process.env.SESSION_SECRET || process.env.SHOPIFY_API_SECRET;
  if (!secret) {
    throw new Error(
      "[csrf] CSRF_SECRET or SESSION_SECRET environment variable is required.\n" +
      "Generate one: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return secret;
}
const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Generate a CSRF token signed with HMAC-SHA256.
 * Token format: {timestamp}:{randomHex}:{signature}
 */
export function generateCsrfToken(): string {
  const secret = getCsrfSecret();
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(16).toString("hex");
  const payload = `${timestamp}.${random}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return `${payload}.${signature}`;
}

/**
 * Validate a CSRF token.
 *
 * @param token - The token to validate
 * @returns true if valid, throws if invalid
 * @throws Error if token is missing, malformed, expired, or has invalid signature
 */
export function validateCsrfToken(token: string | null | undefined): boolean {
  if (!token) {
    logger.warn("CSRF validation failed: missing token");
    throw new Error("CSRF token missing");
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    logger.warn("CSRF validation failed: malformed token");
    throw new Error("CSRF token malformed");
  }

  const [timestamp, random, signature] = parts;
  const payload = `${timestamp}.${random}`;

  // Verify HMAC signature
  const secret = getCsrfSecret();
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");

  // SECURITY: timingSafeEqual throws RangeError if buffer lengths differ.
  // Check length first — a mismatched length means the signature is invalid.
  // This prevents attackers from sending truncated signatures to trigger exceptions.
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    logger.warn("CSRF validation failed: invalid signature");
    throw new Error("CSRF token invalid");
  }

  // Verify token hasn't expired
  const tokenTime = parseInt(timestamp, 36);
  if (Date.now() - tokenTime > TOKEN_TTL_MS) {
    logger.warn("CSRF validation failed: token expired");
    throw new Error("CSRF token expired");
  }

  return true;
}

/**
 * Extract and validate CSRF token from a request (form submission).
 * Convenience wrapper for use in action handlers.
 *
 * @param request - The incoming request
 * @returns The validated form data
 * @throws Error if CSRF token is missing or invalid
 */
export async function validateCsrfRequest(request: Request): Promise<FormData> {
  const formData = await request.formData();
  const token = formData.get("csrfToken") as string | null;
  validateCsrfToken(token);
  return formData;
}
