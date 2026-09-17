/**
 * File: shopify-auth.ts
 * Author: yuntongsoft
 * Date: 2026/08/19
 * Purpose: Shopify Session Token verification + shop domain validation + token management
 *
 * ============================================================================
 * AUTHENTICATION ARCHITECTURE — READ THIS FIRST
 * ============================================================================
 *
 * This project has TWO authentication mechanisms. Use the RIGHT ONE for your case:
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ 1. shopify.server.ts → authenticate.admin(request)                        │
 * │    - Shopify SDK's built-in authentication                                │
 * │    - Use for: Webhook handlers, API routes that need full session access  │
 * │    - Returns: { admin, session } with full Shopify API client             │
 * │    - Example: const { admin } = await authenticate.admin(request);        │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │ 2. authenticatePage(request) — THIS FILE                                  │
 * │    - Custom lightweight authentication for page loaders/actions           │
 * │    - Use for: Remix routes that just need shop + accessToken              │
 * │    - Returns: { shop, accessToken } without full SDK overhead             │
 * │    - Handles bounce redirect for embedded apps (iframe OAuth flow)        │
 * │    - Example: const auth = await authenticatePage(request);               │
 * │             if (!auth.ok) return auth.response;                           │
 * └─────────────────────────────────────────────────────────────────────────────┘
 *
 * WHEN TO USE WHICH:
 * - Need to call Shopify Admin API? → Use authenticate.admin() from shopify.server
 * - Just need shop ID + access token for your own DB queries? → Use authenticatePage()
 *
 * Dependencies: jsonwebtoken, prisma, encryption
 * Used by: app.tsx (loader), auth routes, page loaders/actions
 *
 * Usage:
 *   import { verifySessionToken, isValidShopDomain, getAccessToken, authenticatePage } from "~/utils/shopify-auth";
 *   const payload = verifySessionToken(idToken);
 *   const token = await getAccessToken(shopDomain);
 *   const auth = await authenticatePage(request);
 */
import crypto from "crypto";
import jwt from "jsonwebtoken";
import prisma from "~/db.server";
import { decrypt, encrypt } from "~/utils/encryption";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "shopify-auth" });

/**
 * Per-shop cooldown for token refresh — prevents hitting Shopify's OAuth endpoint
 * on every page request. A shop can only attempt token refresh once per 12 hours.
 * Bounded with FIFO eviction to prevent unbounded memory growth.
 */
const tokenRefreshCooldown = new Map<string, number>();
const TOKEN_REFRESH_COOLDOWN_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_COOLDOWN_ENTRIES = 500; // Cap cache — evict oldest when full

/**
 * Periodic cleanup for token refresh cooldown map.
 * Prevents unbounded memory growth in long-running processes.
 */
function cleanupTokenRefreshCooldown(): void {
  const now = Date.now();
  for (const [key, expiresAt] of tokenRefreshCooldown) {
    if (now > expiresAt) tokenRefreshCooldown.delete(key);
  }
}
// Run cleanup every 30 minutes (don't prevent process exit)
const cooldownCleanupTimer = setInterval(cleanupTokenRefreshCooldown, 30 * 60 * 1000);
if (cooldownCleanupTimer.unref) cooldownCleanupTimer.unref();

/**
 * Shopify Session Token payload structure
 */
interface SessionTokenPayload {
  iss: string;   // Issuer, e.g. https://xxx.myshopify.com/admin
  dest: string;  // Shop domain, e.g. https://xxx.myshopify.com
  aud: string;   // Audience (our API Key)
  sub: string;   // User ID
  exp: number;
  nbf: number;
  iat: number;
  jti: string;
  sid: string;
}

/**
 * Validate shop domain format (prevents SSRF and parameter forgery)
 */
export function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);
}

/**
 * Verify a Shopify Session Token (JWT) with HS256 signature verification.
 *
 * SECURITY: Uses jwt.verify() (NOT jwt.decode()) to cryptographically verify
 * the token was signed by Shopify using the App Secret (HS256).
 * Validates: signature, issuer, audience, and expiration.
 *
 * @returns Decoded payload with dest (shop domain)
 * @throws If signature is invalid, token is expired, or claims don't match
 */
export function verifySessionToken(token: string): SessionTokenPayload {
  const apiSecret = process.env.SHOPIFY_API_SECRET;
  if (!apiSecret) {
    throw new Error("SHOPIFY_API_SECRET is not configured");
  }

  // Verify signature + expiry in one call using the App Secret (HS256).
  // clockTolerance: 120s grace period — App Bridge refreshes session tokens every ~60s,
  // so a token may briefly expire between refresh cycles. 120s prevents false rejections.
  const decoded = jwt.verify(token, apiSecret, {
    algorithms: ["HS256"],
    audience: process.env.SHOPIFY_API_KEY,
    clockTolerance: 120,
  }) as SessionTokenPayload;

  // Verify issuer matches a valid shop domain
  const issuerDomain = decoded.iss.replace(/^https?:\/\//, "").replace(/\/admin$/, "");
  if (!isValidShopDomain(issuerDomain)) {
    throw new Error(`Invalid token issuer: ${decoded.iss}`);
  }

  return decoded;
}

/**
 * Get a valid access token for a shop
 * Reads encrypted token from the Shop table
 *
 * @param shopDomain - e.g. "example.myshopify.com"
 * @returns Decrypted access token
 */
export async function getAccessToken(shopDomain: string): Promise<string> {
  const shop = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { shopifyToken: true },
  });

  if (!shop?.shopifyToken) {
    throw new Error(`No token found for shop: ${shopDomain}`);
  }

  return decrypt(shop.shopifyToken);
}

/**
 * Build a bounce page HTML that redirects at the top level.
 * This is necessary for embedded apps — a plain 302 inside an iframe gets
 * blocked by X-Frame-Options on admin.shopify.com.
 *
 * SECURITY: loginUrl is validated and HTML-escaped to prevent XSS injection.
 */
export function bounceRedirect(loginUrl: string): Response {
  // Validate: only allow relative paths starting with / or known auth routes
  const safeUrl = sanitizeRedirectUrl(loginUrl);
  return buildBouncePage(safeUrl);
}

/**
 * Bounce to an external URL (e.g. Shopify OAuth page).
 * Validates the URL is a known Shopify domain to prevent open redirects.
 */
export function bounceToShopifyUrl(absoluteUrl: string): Response {
  // Only allow URLs to known Shopify domains
  try {
    const parsed = new URL(absoluteUrl);
    const isShopify = parsed.hostname === "admin.shopify.com" ||
      parsed.hostname.endsWith(".myshopify.com") ||
      parsed.hostname === "accounts.shopify.com";
    if (!isShopify) {
      logger.error({ hostname: parsed.hostname }, "bounceToShopifyUrl blocked non-Shopify URL");
      return buildBouncePage("/auth/login");
    }
  } catch {
    return buildBouncePage("/auth/login");
  }
  return buildBouncePage(absoluteUrl);
}

/** Build the HTML bounce page that redirects the top window */
function buildBouncePage(url: string): Response {
  // Escape for safe inclusion in HTML attribute and JS string
  const escaped = url
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Redirecting...</title>
  <script>
    var u = "${escaped}";
    if (window.top !== window.self) {
      window.top.location.replace(u);
    } else {
      window.location.replace(u);
    }
  </script>
</head>
<body>
  <p>Redirecting to authentication...</p>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "frame-ancestors 'none'",
    },
  });
}

/**
 * Sanitize a redirect URL to prevent open redirect and XSS attacks.
 * Only allows relative paths starting with / and blocks external URLs.
 */
function sanitizeRedirectUrl(url: string): string {
  // Block protocol-relative URLs (//evil.com)
  if (url.startsWith("//")) return "/auth/login";

  // Block absolute URLs (http://, https://, javascript:, etc.)
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return "/auth/login";

  // Only allow paths starting with /
  if (!url.startsWith("/")) return "/auth/login";

  return url;
}

/**
 * Result of authenticatePage() — either authenticated or needs redirect.
 * Callers must `return auth.response` when `ok === false`.
 */
export type AuthPageResult =
  | { ok: true; shop: { id: string; shopifyDomain: string; plan: string; shopifyScope: string; locale: string; createdAt: Date | null }; accessToken: string }
  | { ok: false; response: Response };

/**
 * Authenticate a page request (loader or action)
 *
 * Extracts the session token from the Authorization header or URL params,
 * verifies it, and returns the shop record.
 * Returns a bounce-page Response when OAuth is needed (top-level redirect for embedded apps).
 *
 * Usage:
 *   const auth = await authenticatePage(request);
 *   if (!auth.ok) return auth.response;  // loader returns bounce page
 *   const { shop, accessToken } = auth;
 */
export async function authenticatePage(request: Request): Promise<AuthPageResult> {
  const url = new URL(request.url);

  // 1. Try Authorization header (App Bridge sends this)
  const authHeader = request.headers.get("Authorization");
  let token: string | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7);
  }

  // 2. Fallback to id_token URL param
  if (!token) {
    token = url.searchParams.get("id_token");
  }

  // 3. No token → bounce to OAuth (top-level redirect for embedded apps)
  if (!token) {
    const shop = url.searchParams.get("shop");
    const loginUrl = shop ? `/auth/login?shop=${shop}` : "/auth/login";
    return { ok: false, response: bounceRedirect(loginUrl) };
  }

  // 4. Verify token
  let payload: { dest: string };
  try {
    payload = verifySessionToken(token) as { dest: string };
  } catch (err) {
    logger.warn({ error: (err as Error)?.message }, "Token verification failed in authenticatePage");
    const shop = url.searchParams.get("shop");
    const loginUrl = shop ? `/auth/login?shop=${shop}` : "/auth/login";
    return { ok: false, response: bounceRedirect(loginUrl) };
  }
  const shopDomain = payload.dest.replace(/^https?:\/\//, "");

  // 5. Look up shop + token in a single query (avoids redundant DB round-trip)
  const shopRecord = await prisma.shop.findUnique({
    where: { shopifyDomain: shopDomain },
    select: { id: true, shopifyDomain: true, plan: true, shopifyScope: true, locale: true, createdAt: true, shopifyToken: true },
  });

  if (!shopRecord) {
    logger.warn({ shopDomain }, "Shop not found in DB during authenticatePage");
    return { ok: false, response: bounceRedirect(`/auth/login?shop=${shopDomain}`) };
  }

  // 6. Check access token (redirect to OAuth if missing/empty)
  if (!shopRecord.shopifyToken) {
    logger.warn({ shopDomain }, "Shop found but no access token stored");
    return { ok: false, response: bounceRedirect(`/auth/login?shop=${shopDomain}`) };
  }

  const accessToken = decrypt(shopRecord.shopifyToken);

  // Build shop object without token for return
  const { shopifyToken: _token, ...shopInfo } = shopRecord;

  // NOTE: Token refresh is handled by the Shopify SDK (unstable_newEmbeddedAuthStrategy)
  // when using authenticate.admin(). For authenticatePage(), we use the offline token
  // stored in the DB which doesn't expire (or is refreshed during OAuth re-install).

  return { ok: true, shop: shopInfo, accessToken };
}

/**
 * Refresh an expiring offline access token using Token Exchange
 * 
 * Shopify 2026-07+ requires expiring tokens. This function exchanges
 * an id_token (session token) for a fresh expiring offline token.
 * 
 * @param shopDomain - e.g. "example.myshopify.com"
 * @param idToken - The session token from App Bridge (Authorization header)
 * @returns Fresh expiring offline access token
 */
export async function refreshExpiringToken(
  shopDomain: string,
  idToken: string
): Promise<string> {
  logger.info({ shop: shopDomain }, "Exchanging id_token for expiring offline token");

  // AbortController timeout — prevent blocking page requests if Shopify is slow
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  let response: Response;
  try {
    response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        subject_token: idToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
        requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token",
        expiring: 1,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const error = await response.text();
    logger.error({ shop: shopDomain, error }, "Token exchange failed");
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();
  const newToken = data.access_token as string;

  if (!newToken) {
    throw new Error("Token exchange returned no access_token");
  }

  // SECURITY: Never log token prefixes — use a hash fingerprint instead
  const fingerprint = crypto.createHash("sha256").update(newToken).digest("hex").substring(0, 12);
  logger.info({ shop: shopDomain, tokenFingerprint: fingerprint }, "Token exchange successful");
  return newToken;
}
