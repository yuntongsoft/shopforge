# Authentication Architecture

> Two authentication mechanisms serve different use cases: the Shopify SDK's full-session auth
> for API routes, and a custom lightweight page auth for Remix loaders/actions.

---

## Table of Contents

1. [Dual Auth System](#dual-auth-system)
2. [SDK Auth — shopify.server.ts](#sdk-auth--shopify-server-ts)
3. [Page Auth — shopify-auth.server.ts](#page-auth--shopify-auth-server-ts)
4. [Session Token Verification](#session-token-verification)
5. [Token Exchange Flow](#token-exchange-flow)
6. [Bounce Redirect (iframe Breaking)](#bounce-redirect-iframe-breaking)
7. [Token Refresh](#token-refresh)
8. [Security Hardening](#security-hardening)
9. [Decision Matrix](#decision-matrix)

---

## Dual Auth System

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  Mechanism 1: shopify.server.ts → authenticate.admin(request)           │
  │  ─────────────────────────────────────────────────────────────────────── │
  │  Source:    Shopify SDK built-in                                        │
  │  Use for:   Webhook handlers, API routes needing full session access    │
  │  Returns:   { admin, session } with Shopify API client                  │
  │  Example:   const { admin } = await authenticate.admin(request);        │
  └──────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────────────────┐
  │  Mechanism 2: authenticatePage(request) — shopify-auth.server.ts        │
  │  ─────────────────────────────────────────────────────────────────────── │
  │  Source:    Custom lightweight implementation                           │
  │  Use for:   Remix page loaders/actions needing shop + accessToken only  │
  │  Returns:   { shop, accessToken } without SDK overhead                  │
  │  Example:   const auth = await authenticatePage(request);               │
  │             if (!auth.ok) return auth.response;                         │
  └──────────────────────────────────────────────────────────────────────────┘
```

**Why two mechanisms?** The SDK's `authenticate.admin()` requires both `shop` and `host` URL
params. When the app is first loaded from Shopify Admin, `host` may be missing, causing a
broken redirect loop. The custom `authenticatePage()` extracts the shop from the session token
(JWT) instead, avoiding this dependency.

---

## SDK Auth — shopify.server.ts

The SDK auth is configured in `shopify.server.ts` using `createShopifyApp()`. It handles:

- OAuth flow (install + re-auth)
- Session storage (Prisma adapter)
- Webhook HMAC verification
- Admin API client creation

```typescript
// In a loader or action:
const { admin, session } = await authenticate.admin(request);
// admin.graphql(...) — call Shopify Admin API
// session.shop — shop domain
// session.accessToken — offline access token
```

**Use when:**
- Calling Shopify Admin API (GraphQL or REST)
- Processing webhooks (HMAC verification built-in)
- Needing the full session object (userId, scope, expiry)

---

## Page Auth — shopify-auth.server.ts

### authenticatePage() Flow

```
  Request
    │
    ├── 1. Extract id_token from Authorization header or URL param
    │
    ├── 2. Verify session token (JWT) → extract shop domain from "dest" claim
    │      └── fallback: extract shop from URL ?shop= param
    │      └── fallback: most recent shop in DB (single-shop dev)
    │
    ├── 3. Look up shop in DB
    │      ├── Found with valid token → FAST PATH → return { shop, accessToken }
    │      │
    │      └── Not found or no token
    │             ├── Has id_token → TOKEN EXCHANGE PATH
    │             │     ├── Exchange id_token for offline access token
    │             │     ├── Register shop in DB (upsert)
    │             │     └── Return { shop, accessToken }
    │             │
    │             └── No id_token → BOUNCE PATH
    │                   └── Return bounce redirect to /auth/login?shop=xxx
    │
    └── AuthPageResult: { ok: true, shop, accessToken }
                       | { ok: false, response } (bounce HTML)
                       | { ok: false, needsRefresh: true, shopDomain }
```

### Auth Paths

| Path | Condition | Behavior |
|------|-----------|----------|
| **Fast path** | Shop in DB with valid encrypted token | Decrypt token, return immediately |
| **Token exchange** | Shop not in DB, but has valid id_token | Exchange id_token → offline token via Shopify API, register shop |
| **Bounce** | No valid id_token, shop not in DB | Return HTML page that breaks out of iframe → OAuth |
| **Token recovery** | Shop in DB but token decryption fails | Attempt token exchange as recovery; if fails, bounce |

### AuthPageResult Type

```typescript
type AuthPageResult =
  | { ok: true; shop: ShopInfo; accessToken: string }
  | { ok: false; response: Response }          // bounce HTML
  | { ok: false; needsRefresh: true; shopDomain: string };  // graceful degradation
```

The `needsRefresh` state allows loaders to return safe default JSON so the page renders with
empty data instead of erroring. The user refreshes to get real data after the token exchange
completes.

---

## Session Token Verification

Shopify App Bridge generates session tokens (JWTs) every ~60 seconds. These tokens are sent
in the `Authorization: Bearer <token>` header or as an `id_token` URL parameter.

### Token Structure

```json
{
  "iss": "https://example.myshopify.com/admin",
  "dest": "https://example.myshopify.com",
  "aud": "YOUR_API_KEY",
  "sub": "12345",
  "exp": 1699999999,
  "nbf": 1699996399,
  "iat": 1699996399,
  "jti": "unique-token-id",
  "sid": "session-id"
}
```

### Verification Steps

```typescript
const decoded = jwt.verify(token, apiSecret, {
  algorithms: ["HS256"],        // Only accept HS256 — prevent algorithm confusion
  audience: SHOPIFY_API_KEY,    // Must match our app's API key
  clockTolerance: 120,          // 120s grace — tokens refresh every ~60s
});

// Verify issuer is a valid shop domain
const issuerDomain = decoded.iss.replace(/^https?:\/\//, "").replace(/\/admin$/, "");
if (!isValidShopDomain(issuerDomain)) throw new Error("Invalid issuer");
```

| Check | Protection |
|-------|------------|
| HS256 algorithm whitelist | Prevents algorithm confusion attacks (e.g., `none`) |
| Audience = API key | Ensures token was issued for THIS app |
| Expiry + 120s clock tolerance | Prevents replay of stale tokens; allows for clock skew |
| Issuer domain validation | Prevents tokens from other shops or forged issuers |

---

## Token Exchange Flow

Shopify's Token Exchange API converts a session token (id_token) into an offline access token
without requiring a redirect-based OAuth flow.

```
  App                              Shopify
   │                                  │
   ├──POST /admin/oauth/access_token─→│
   │   {                              │
   │     client_id: API_KEY,          │
   │     client_secret: API_SECRET,   │
   │     grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
   │     subject_token: id_token,     │
   │     subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
   │     requested_token_type: "urn:shopify:params:oauth:token-type:offline-access-token"
   │   }                              │
   │                                  │
   │←──{ access_token: "shp_..." }────│
   │                                  │
```

**Timeout**: 5 seconds via `AbortController`. Prevents slow Shopify responses from blocking
page loads.

**Expiring tokens** (Shopify 2026-07+): Add `expiring: 1` to the request body to get a
time-limited offline token. Use `refreshExpiringToken()` for this variant.

---

## Bounce Redirect (iframe Breaking)

Shopify apps run inside an iframe in the Admin. A standard HTTP 302 redirect inside an iframe
is blocked by `X-Frame-Options` on `admin.shopify.com`. The solution is a "bounce page" — an
HTML page that renders inside the iframe and uses JavaScript to redirect the **top window**.

```html
<!DOCTYPE html>
<html>
<head>
  <script>
    var u = "/auth/login?shop=example.myshopify.com";
    if (window.top !== window.self) {
      window.top.location.replace(u);  // Break out of iframe
    } else {
      window.location.replace(u);      // Already at top level
    }
  </script>
</head>
<body><p>Redirecting to authentication...</p></body>
</html>
```

**Security measures:**

| Measure | Protection |
|---------|------------|
| HTML-escape all URL characters | Prevents XSS via crafted URLs |
| `sanitizeRedirectUrl()` — relative paths only | Prevents open redirect to external sites |
| `bounceToShopifyUrl()` — whitelist Shopify domains | Only allows redirects to `*.myshopify.com`, `admin.shopify.com`, `accounts.shopify.com` |
| Block `//` prefix | Prevents protocol-relative URL bypass |
| Block `javascript:` scheme | Prevents script injection |
| No `X-Frame-Options` on bounce page | Page MUST render inside the iframe to execute the JS |

---

## Token Refresh

### Cooldown Mechanism

Token refresh is rate-limited per shop to prevent hitting Shopify's OAuth endpoint on every
page request:

```
tokenRefreshCooldown: Map<shop, expiresAt>
  ├── Max entries: 500 (FIFO eviction when full)
  ├── Cooldown: 12 hours per shop
  └── Cleanup: every 30 minutes (unref'd timer)
```

### refreshExpiringToken()

For Shopify 2026-07+ expiring tokens, exchange an id_token for a fresh offline token:

```typescript
const newToken = await refreshExpiringToken(shopDomain, idToken);
// Store encrypted: await encrypt(newToken) → DB
```

**Security**: Tokens are never logged in raw form. A SHA-256 fingerprint (first 12 hex chars)
is used for log correlation:

```typescript
const fingerprint = crypto.createHash("sha256").update(token).digest("hex").substring(0, 12);
logger.info({ shop, tokenFingerprint: fingerprint }, "Token exchange successful");
```

---

## Security Hardening

### Shop Domain Validation

```typescript
function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);
}
```

- Only allows `*.myshopify.com` domains
- Prevents SSRF via crafted shop parameters
- Rejects empty strings, special characters, and non-Shopify domains

### Token Storage

- Access tokens are encrypted at rest using AES-256-GCM (`encrypt()`/`decrypt()`)
- Encryption key from `ENCRYPTION_KEY` env var (min 32 chars / 256 bits)
- Token decryption failure triggers automatic recovery via token exchange

### Memory Safety

| Mechanism | Protection |
|-----------|------------|
| Bounded cooldown map (500 entries) | Prevents unbounded memory growth |
| FIFO eviction | Oldest entries removed first |
| Periodic cleanup (30 min, unref'd) | Removes expired entries; doesn't prevent process exit |

---

## Decision Matrix

| Scenario | Use |
|----------|-----|
| Remix page loader/action | `authenticatePage()` |
| Webhook handler | `authenticate.admin()` (SDK) |
| API route calling Shopify Admin API | `authenticate.admin()` (SDK) |
| API route needing only shop + token | `authenticatePage()` |
| Billing action needing id_token | `extractIdToken(request)` |
| Token refresh (expiring tokens) | `refreshExpiringToken(shop, idToken)` |
| Getting stored access token | `getAccessToken(shopDomain)` |
