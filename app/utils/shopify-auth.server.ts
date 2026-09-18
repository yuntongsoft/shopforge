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
import { registerShop } from "~/utils/shop-registration";
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
      // NOTE: Do NOT set X-Frame-Options or frame-ancestors here.
      // The bounce page MUST render inside the Shopify Admin iframe
      // so its JS can execute window.top.location.replace() to break
      // out and redirect the top window to the OAuth flow.
      "Cache-Control": "no-store",
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
 * Result of authenticatePage() — authenticated, needs redirect, or needs refresh.
 *
 * ok === true  → shop + accessToken ready for use
 * ok === false, response → bounce HTML (Remix renders React tree anyway, so this
 *                          only works for HTTP redirects; component sees undefined data)
 * ok === false, needsRefresh → token exchange failed but shop domain is known;
 *                              loader should return safe default JSON so the page
 *                              renders with empty data; user refreshes to get real data
 */
export type AuthPageResult =
  | { ok: true; shop: { id: string; shopifyDomain: string; plan: string; shopifyScope: string; locale: string; createdAt: Date | null }; accessToken: string }
  | { ok: false; response: Response }
  | { ok: false; needsRefresh: true; shopDomain: string };

/**
 * Convert a failed AuthPageResult to a Response.
 * For non-homepage loaders that don't handle needsRefresh specially.
 */
export function authResponse(auth: Extract<AuthPageResult, { ok: false }>): Response {
  if ("response" in auth) return auth.response;
  return bounceRedirect(`/auth/login?shop=${auth.shopDomain}`);
}

/**
 * Authenticate a page request (loader or action)
 *
 * Authentication flow (compatible with unstable_newEmbeddedAuthStrategy):
 *
 * Fast path (existing shop):
 *   1. Extract shop from id_token (JWT) or URL param
 *   2. Look up shop in DB → if found with valid token, return immediately
 *
 * Token exchange path (new install / first visit):
 *   1. Verify id_token → extract shop domain
 *   2. Exchange id_token for offline access token via Shopify's token exchange API
 *   3. Register shop in DB (upsert)
 *   4. Return shop data + access token
 *
 * Fallback (no valid id_token, shop not in DB):
 *   1. Bounce to /auth/login?shop=xxx for traditional OAuth
 *
 * NOTE: We do NOT use SDK's authenticate.admin() here because it requires
 * both `shop` and `host` URL params. When the app is first loaded from
 * Shopify Admin, `host` may be missing, causing the SDK to redirect to
 * /auth/login without shop param → broken redirect loop.
 *
 * Usage:
 *   const auth = await authenticatePage(request);
 *   if (!auth.ok) return auth.response;
 *   const { shop, accessToken } = auth;
 */
export async function authenticatePage(request: Request): Promise<AuthPageResult> {
  const url = new URL(request.url);

  // 1. Extract session token from Authorization header or id_token URL param
  const authHeader = request.headers.get("Authorization");
  let token: string | null = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) token = url.searchParams.get("id_token");

  // 2. Try to extract shop domain from session token
  let shopDomain: string | null = null;
  if (token) {
    try {
      const payload = verifySessionToken(token) as { dest: string };
      shopDomain = payload.dest.replace(/^https?:\/\//, "");
    } catch (err) {
      logger.debug({ error: (err as Error)?.message }, "Session token verification failed, falling back to shop param");
    }
  }

  // 3. Fallback: extract shop from URL param
  if (!shopDomain) shopDomain = url.searchParams.get("shop");

  // 4. DB fallback — most recently installed shop (single-shop dev environments)
  if (!shopDomain) {
    try {
      const lastShop = await prisma.shop.findFirst({
        where: { isDeleted: false },
        orderBy: { createdAt: "desc" },
        select: { shopifyDomain: true },
      });
      if (lastShop) shopDomain = lastShop.shopifyDomain;
    } catch { /* DB unavailable */ }
  }

  // 5. No shop at all → need OAuth
  if (!shopDomain) {
    logger.warn({}, "No shop domain available in authenticatePage");
    return { ok: false, response: bounceRedirect("/auth/login") };
  }

  // 6. Look up shop in DB
  const shopRecord = await prisma.shop.findFirst({
    where: { shopifyDomain: shopDomain, isDeleted: false },
    select: { id: true, shopifyDomain: true, plan: true, shopifyScope: true, locale: true, createdAt: true, shopifyToken: true },
  });

  // 7. Shop found with valid token → fast path
  if (shopRecord?.shopifyToken) {
    const { shopifyToken: _token, ...shopInfo } = shopRecord;
    let accessToken: string;
    try {
      accessToken = decrypt(shopRecord.shopifyToken);
    } catch (err) {
      logger.error({ shop: shopDomain, error: (err as Error)?.message }, "Failed to decrypt stored access token");
      // Token corrupted — fall through to token exchange to get a fresh one
      if (token) {
        try {
          accessToken = await exchangeTokenForOfflineAccess(shopDomain, token);
          await registerShop(shopDomain, accessToken, process.env.SHOPIFY_SCOPES || "");
          logger.info({ shop: shopDomain }, "Shop re-registered after token decryption failure");
          const reRegistered = await prisma.shop.findFirst({
            where: { shopifyDomain: shopDomain, isDeleted: false },
            select: { id: true, shopifyDomain: true, plan: true, shopifyScope: true, locale: true, createdAt: true },
          });
          if (reRegistered) return { ok: true, shop: reRegistered, accessToken };
        } catch (exchangeErr) {
          logger.error({ shop: shopDomain, error: (exchangeErr as Error)?.message }, "Token exchange after decryption failure also failed");
        }
      }
      logger.warn({ shopDomain }, "Token decryption failed and recovery failed, bouncing to OAuth");
      return { ok: false, response: bounceRedirect(`/auth/login?shop=${shopDomain}`) };
    }
    logger.debug({ shop: shopDomain }, "authenticatePage fast path: shop found in DB with valid token");
    return { ok: true, shop: shopInfo, accessToken };
  }

  // 8. Shop not in DB or no access token → try token exchange
  logger.info({ shop: shopDomain, hasToken: !!token, shopInDb: !!shopRecord }, "Shop needs token exchange or OAuth");
  if (token) {
    try {
      logger.info({ shop: shopDomain }, "Shop not in DB or missing token, attempting token exchange");
      const accessToken = await exchangeTokenForOfflineAccess(shopDomain, token);

      // Register shop in DB (upsert — creates or updates existing record)
      await registerShop(shopDomain, accessToken, process.env.SHOPIFY_SCOPES || "");
      logger.info({ shop: shopDomain }, "Shop registered via token exchange");

      // Re-query to get the full shop record with all fields
      const registered = await prisma.shop.findFirst({
        where: { shopifyDomain: shopDomain, isDeleted: false },
        select: { id: true, shopifyDomain: true, plan: true, shopifyScope: true, locale: true, createdAt: true },
      });

      if (registered) {
        return { ok: true, shop: registered, accessToken };
      }
    } catch (err) {
      logger.error({ shop: shopDomain, error: (err as Error)?.message }, "Token exchange failed");
      // Fall through to bounce redirect
    }
  }

  // 9. Token exchange failed or no valid token
  //    Return needsRefresh so the loader returns safe defaults — page renders
  //    with empty data, user refreshes to get real data.
  logger.warn({ shopDomain }, "Token exchange failed, returning needsRefresh for graceful degradation");
  return { ok: false, needsRefresh: true, shopDomain };
}

/**
 * Exchange an id_token (session token) for an offline access token.
 * Uses Shopify's token exchange endpoint — no redirect needed.
 */
async function exchangeTokenForOfflineAccess(shopDomain: string, idToken: string): Promise<string> {
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
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();
  const accessToken = data.access_token as string;
  if (!accessToken) throw new Error("Token exchange returned no access_token");

  const fingerprint = crypto.createHash("sha256").update(accessToken).digest("hex").substring(0, 12);
  logger.info({ shop: shopDomain, tokenFingerprint: fingerprint }, "Token exchange successful");
  return accessToken;
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
