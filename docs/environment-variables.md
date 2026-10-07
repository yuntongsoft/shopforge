# Environment Variables Reference

> All environment variables used by ShopForge, organized by module.
> Validated at startup by `env-validator.ts` — missing required vars prevent the server from starting.

---

## Table of Contents

1. [Required Variables](#required-variables)
2. [Optional Variables](#optional-variables)
3. [Rate Limiter Variables](#rate-limiter-variables)
4. [Variable Reference by Module](#variable-reference-by-module)
5. [Generating Secure Values](#generating-secure-values)

---

## Required Variables

These variables **must** be set. The server will refuse to start if any are missing.

| Variable | Description | Example |
|----------|-------------|---------|
| `SHOPIFY_API_KEY` | App API key from Partner Dashboard | `abc123def456` |
| `SHOPIFY_API_SECRET` | App API secret from Partner Dashboard (used for HMAC verification + JWT signing) | `shp_secret_xxxxx` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/shopforge` |
| `ENCRYPTION_KEY` | AES-256 encryption key for access tokens and privacy payloads. Must be at least 32 characters (64 hex chars = 32 bytes). | `a1b2c3...` (64 hex chars) |

---

## Optional Variables

These variables have sensible defaults. Warnings are logged at startup if not set.

| Variable | Default | Description |
|----------|---------|-------------|
| `APP_URL` | `http://localhost:3000` | Public URL of the app. Should start with `http://` or `https://`. Auto-detected by Shopify CLI in dev. |
| `RESEND_API_KEY` | *(not set)* | Resend API key for transactional emails. If not set, emails are mocked in dev (logged, not sent). |
| `REDIS_URL` | *(not set)* | Redis connection URL for rate limiter state sharing across processes. If not set, falls back to DB. |
| `SHOPIFY_SCOPES` | *(from config)* | Comma-separated list of API scopes. Set during OAuth. |

---

## Rate Limiter Variables

These override the default behavior of the Shopify API rate limiter. All have sensible defaults.

| Variable | Default | Description |
|----------|---------|-------------|
| `RATE_LIMIT_DELAY_CURVE` | `[[50,0],[70,50],[80,200],[90,600],[95,1200],[100,2000]]` | Delay curve breakpoints as JSON array of `[usagePercent, delayMs]` pairs. Linear interpolation between points. |
| `RATE_LIMIT_REFILL_RATE` | `50` | Shopify leaky bucket refill rate (calls/sec). Shopify's actual rate is ~50. |
| `RATE_LIMIT_STALE_THRESHOLD_MS` | `30000` | If no rate limit update for this duration, assume bucket is fully refilled. |
| `RATE_LIMIT_CB_THRESHOLD` | `5` | Consecutive 429 responses before circuit breaker opens. |
| `RATE_LIMIT_CB_WINDOW_MS` | `60000` | Time window (ms) for counting consecutive 429s. |
| `RATE_LIMIT_CB_COOLDOWN_MS` | `30000` | How long the circuit stays open before allowing a probe request. |

### Delay Curve Explained

The delay curve controls how aggressively the rate limiter throttles requests as API usage increases:

```
Usage %    Delay (ms)
  0-50        0        — Full speed, plenty of headroom
  50-70       0-50     — Gentle ramp
  70-80       50-200   — Moderate throttling
  80-90       200-600  — Heavy throttling
  90-95       600-1200 — Very heavy
  95-100      1200-2000— Near capacity, maximum delay
```

Override with a custom curve:

```bash
RATE_LIMIT_DELAY_CURVE='[[40,0],[60,100],[80,500],[95,3000],[100,5000]]'
```

---

## Variable Reference by Module

### Core (env-validator.ts)

| Variable | Severity | Validated By |
|----------|----------|-------------|
| `SHOPIFY_API_KEY` | Required | Non-empty check |
| `SHOPIFY_API_SECRET` | Required | Non-empty check |
| `DATABASE_URL` | Required | Non-empty check |
| `ENCRYPTION_KEY` | Required | Non-empty + min 32 chars |
| `APP_URL` | Warning | Non-empty + starts with `http` |
| `RESEND_API_KEY` | Warning | Non-empty check |

### Authentication (shopify-auth.server.ts)

| Variable | Used For |
|----------|----------|
| `SHOPIFY_API_KEY` | JWT audience validation, token exchange `client_id` |
| `SHOPIFY_API_SECRET` | JWT signature verification (HS256), token exchange `client_secret` |
| `ENCRYPTION_KEY` | Encrypt/decrypt stored access tokens |

### Rate Limiter (shopify-rate-limiter.ts)

| Variable | Used For |
|----------|----------|
| `REDIS_URL` | Optional Redis backend for cross-process state |
| `RATE_LIMIT_DELAY_CURVE` | Custom delay curve breakpoints |
| `RATE_LIMIT_REFILL_RATE` | Leaky bucket refill rate assumption |
| `RATE_LIMIT_STALE_THRESHOLD_MS` | Stale state detection threshold |
| `RATE_LIMIT_CB_THRESHOLD` | Circuit breaker open threshold |
| `RATE_LIMIT_CB_WINDOW_MS` | Circuit breaker 429 counting window |
| `RATE_LIMIT_CB_COOLDOWN_MS` | Circuit breaker open duration |

### Privacy (privacy.server.ts)

| Variable | Used For |
|----------|----------|
| `ENCRYPTION_KEY` | Encrypt sealed payloads and confirmedBy field |

### Outbound Webhooks (webhook-outbound.ts)

| Variable | Used For |
|----------|----------|
| *(none)* | All config from DB (WebhookConfig table) |

---

## Generating Secure Values

### ENCRYPTION_KEY (64 hex chars = 32 bytes)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Webhook Signing Secret (64 hex chars = 32 bytes)

```typescript
import { generateWebhookSecret } from "~/services/webhook-outbound";
const secret = generateWebhookSecret();
```

Or from the command line:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Startup Validation

The `validateEnv()` function runs at server startup (`server.mjs`):

```
[env]  RESEND_API_KEY: Not set — emails will be mocked in dev (logged, not sent)
[env]  APP_URL: Not set — defaults to http://localhost:3000
```

If required variables are missing, the server throws:

```
[env] Missing required environment variables:
  • SHOPIFY_API_KEY: Missing — get it from Partner Dashboard
  • ENCRYPTION_KEY: Missing — generate with: node -e "..."

Fix: Copy .env.example to .env and fill in the values.
```

For health checks, use `getEnvIssues()` to get all issues without throwing:

```typescript
import { getEnvIssues } from "~/utils/env-validator";
const issues = getEnvIssues();
// [{ variable, severity, message }, ...]
```
