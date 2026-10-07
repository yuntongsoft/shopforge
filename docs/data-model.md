# Data Model

> Prisma schema reference for ShopForge. 10 models covering OAuth, business data,
> webhook infrastructure, rate limiting, and GDPR compliance.

---

## Table of Contents

1. [Entity Relationship Diagram](#entity-relationship-diagram)
2. [Model Reference](#model-reference)
3. [Relationships & Cascade Rules](#relationships--cascade-rules)
4. [Index Strategy](#index-strategy)
5. [Design Decisions](#design-decisions)

---

## Entity Relationship Diagram

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │                              Shop                                    │
  │  id (UUID PK)                                                        │
  │  shopifyDomain (unique)    ←── Session.shop (no FK, app-level)      │
  │  shopifyToken (encrypted)                                            │
  │  shopifyScope               plan         subscriptionId              │
  │  subscriptionStatus         locale       isDeleted                   │
  │  installationId             merchantEmail                            │
  │  pending* (OAuth flow state)                                         │
  │                                                                      │
  │  ┌──────────┐  ┌──────────────┐  ┌────────────────┐                │
  │  │ Order[]  │  │ShopFunction[]│  │WebhookConfig[] │                │
  │  │ (cascade)│  │  (cascade)   │  │   (cascade)    │                │
  │  └──────────┘  └──────────────┘  └────────────────┘                │
  └──────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
  │      Session        │  │       Order          │  │    ShopFunction      │
  │  id (PK, no UUID)   │  │  id (UUID PK)        │  │  id (UUID PK)        │
  │  shop (indexed)     │  │  shopId (FK→Shop)    │  │  shopId (FK→Shop)    │
  │  state              │  │  orderNumber         │  │  ruleType            │
  │  isOnline           │  │  customer            │  │  functionId          │
  │  accessToken        │  │  amount (Float)      │  │  label               │
  │  refreshToken       │  │  status              │  │                      │
  │  refreshLeaseId     │  │  note                │  │  @@unique([shopId,   │
  │  credentialVersion  │  │                      │  │           ruleType])  │
  │  (SDK-managed)      │  │  @@index([shopId,    │  └──────────────────────┘
  └─────────────────────┘  │            createdAt]│
                           └──────────────────────┘

  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
  │    WebhookConfig     │  │     WebhookJob       │  │   PrivacyRequest     │
  │  id (UUID PK)        │  │  id (UUID PK)        │  │  id (UUID PK)        │
  │  shopId (FK→Shop)    │  │  topic               │  │  shop                │
  │  url                 │  │  shopDomain          │  │  webhookId           │
  │  secret (HMAC key)   │  │  webhookId           │  │  kind                │
  │  events (JSON [])    │  │  payload (JSON str)  │  │  status              │
  │  isActive            │  │  status              │  │  sealedPayload       │
  │                      │  │  attempts            │  │  (encrypted)         │
  │  @@index([shopId,    │  │  retryAfter          │  │  expiresAt           │
  │           isActive]) │  │  lastError           │  │  confirmedBy         │
  └──────────────────────┘  │                      │  │  (encrypted)         │
                            │  @@unique([topic,    │  │                      │
                            │    shopDomain,       │  │  @@unique([shop,     │
                            │    webhookId])       │  │        webhookId])   │
                            └──────────────────────┘  └──────────────────────┘

  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────┐
  │  WebhookExecution    │  │   OperationLease     │  │   RateLimitCache     │
  │  id (UUID PK)        │  │  key (PK)            │  │  shopDomain (PK)     │
  │  shop                │  │  owner               │  │  state (JSON str)    │
  │  webhookId           │  │  expiresAt           │  │  expiresAt           │
  │  topic               │  │                      │  │                      │
  │  handlerId           │  │  (distributed lock   │  │  (DB fallback for    │
  │  status              │  │   for business ops)  │  │   Redis rate limit)  │
  │  attempts            │  └──────────────────────┘  └──────────────────────┘
  │  leaseId / until     │
  │  traceId             │
  │                      │
  │  @@unique([shop,     │
  │    webhookId,        │
  │    handlerId])       │
  └──────────────────────┘
```

---

## Model Reference

### Shop

Central tenant model. Stores OAuth tokens, plan status, and app configuration.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `shopifyDomain` | String (unique) | e.g., `example.myshopify.com` |
| `shopifyToken` | String | AES-256-GCM encrypted access token |
| `shopifyScope` | String | Comma-separated API scopes |
| `plan` | String | `free`, `pro`, `enterprise` |
| `subscriptionId` | String? | Shopify billing subscription ID |
| `subscriptionStatus` | String | `NONE`, `PENDING`, `ACTIVE`, `CANCELLED` |
| `isDeleted` | Boolean | Soft-delete flag (set by APP_UNINSTALLED) |
| `installationId` | UUID | Changes on each reinstall — detects fresh installs |
| `pendingSubscriptionId` | String? | In-flight billing confirmation |
| `pendingPlan` | String? | Plan being confirmed |
| `pendingConfirmation` | String? | Confirmation token |
| `locale` | String | Shop's locale (`en`, `zh`, `ja`, etc.) |
| `merchantEmail` | String | Contact email for notifications |

### Session

OAuth session storage managed by `@shopify/shopify-app-session-storage-prisma`.

**No FK to Shop** — the SDK stores sessions during OAuth, before the Shop record exists.
Application-level cleanup handles orphaned sessions.

| Column | Type | Notes |
|--------|------|-------|
| `id` | String (PK) | Session ID (not UUID — SDK generates) |
| `shop` | String (indexed) | Shop domain |
| `accessToken` | String | Session access token |
| `isOnline` | Boolean | Online (per-user) vs offline (per-shop) token |
| `refreshToken` | String? | For online token refresh |
| `refreshLeaseId` | String? | Distributed lock for concurrent refresh |
| `credentialVersion` | Int | Token format version for migration |

### Order

Example business model — replace with your real feature via the code generator.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `shopId` | String (FK) | References Shop, cascade delete |
| `orderNumber` | String | Shopify order number |
| `amount` | Float | Cross-DB compatible; use Decimal for production PG/MySQL |
| `status` | String | `pending`, `completed`, `cancelled` |

### ShopFunction

Maps business rule types to deployed Shopify Function GIDs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `shopId` | String (FK) | References Shop, cascade delete |
| `ruleType` | String | Business rule type identifier |
| `functionId` | String | Shopify Function GID |
| `label` | String | Human-readable label |

**Unique constraint**: `[shopId, ruleType]` — one function per rule type per shop.

### WebhookJob

Async queue for heavy webhook processing. See [Webhook System](webhook-system.md) for details.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `topic` | String | Shopify webhook topic |
| `shopDomain` | String | Shop domain |
| `webhookId` | String? | X-Shopify-Webhook-Id for dedup |
| `payload` | String | JSON string (cross-DB compatible) |
| `status` | String | `pending`, `processing`, `completed`, `failed` |
| `attempts` | Int | Processing attempt count (generation counter for CAS) |
| `retryAfter` | DateTime? | Exponential backoff delay |
| `lastError` | String? | Error message (max 2000 chars) |

**Unique constraint**: `[topic, shopDomain, webhookId]` — idempotent dedup for Shopify retries.

### WebhookConfig

Outbound event push configuration for merchant-registered URLs.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `shopId` | String (FK) | References Shop, cascade delete |
| `url` | String | Delivery target URL |
| `secret` | String | HMAC-SHA256 signing key |
| `events` | String | JSON array of subscribed event types |
| `isActive` | Boolean | Enable/disable without deleting |

### PrivacyRequest

GDPR webhook request tracking with confirmation workflow. See [Privacy & GDPR](privacy-gdpr.md).

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `shop` | String | Shop domain |
| `webhookId` | String | For dedup |
| `kind` | String | `DATA_REQUEST` or `REDACT` |
| `status` | String | `PENDING`, `READY`, `REVIEW_REQUIRED`, `COMPLETED` |
| `sealedPayload` | String? | AES-encrypted JSON (cleared on expiry) |
| `expiresAt` | DateTime | 30-day retention deadline |
| `confirmedBy` | String? | AES-encrypted actor identity |

### WebhookExecution

Tracks individual webhook handler executions with lease-based concurrency control.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `shop` | String | Shop domain |
| `webhookId` | String | X-Shopify-Webhook-Id |
| `handlerId` | String | Handler identifier |
| `status` | String | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` |
| `leaseId` | String? | Distributed lock owner |
| `leaseUntil` | DateTime? | Lock expiry |
| `traceId` | String | Request tracing ID |

**Unique constraint**: `[shop, webhookId, handlerId]` — one execution per handler per event.

### OperationLease

Short-term distributed lock for business operations. Network calls are executed outside
the transaction to avoid holding DB locks during I/O.

| Column | Type | Notes |
|--------|------|-------|
| `key` | String (PK) | Operation identifier |
| `owner` | String | Lock holder |
| `expiresAt` | DateTime | Lock expiry |

### RateLimitCache

DB fallback for Shopify API rate limit state when Redis is unavailable. See
[Rate Limiter](shopify-rate-limiter.md).

| Column | Type | Notes |
|--------|------|-------|
| `shopDomain` | String (PK) | Shop domain |
| `state` | String | JSON: `{ used, capacity, lastUpdate, blockedUntil }` |
| `expiresAt` | DateTime | 5-minute TTL (matches Redis TTL) |

---

## Relationships & Cascade Rules

| Parent | Child | FK | On Delete |
|--------|-------|----|-----------|
| Shop | Order | `shopId` | **Cascade** |
| Shop | ShopFunction | `shopId` | **Cascade** |
| Shop | WebhookConfig | `shopId` | **Cascade** |
| Shop | Session | *(no FK)* | App-level cleanup |

**Why Session has no FK**: The Shopify SDK stores sessions during OAuth, before the Shop
record exists. Adding a FK would require the Shop to exist first, breaking the OAuth flow.
Instead, `APP_UNINSTALLED` and `SHOP_REDACT` handlers explicitly delete sessions by shop domain.

**SHOP_REDACT cascade**: Deleting a Shop cascades to Order, ShopFunction, and WebhookConfig
via FK constraints. Sessions are deleted explicitly in the same transaction.

---

## Index Strategy

| Model | Index | Purpose |
|-------|-------|---------|
| Shop | `@@index([plan, isDeleted])` | Filter active shops by plan (composite > two singles) |
| Shop | `@@index([isDeleted, updatedAt])` | Recent activity queries excluding soft-deleted |
| Session | `@@index([shop])` | Lookup sessions by shop domain |
| Order | `@@index([shopId, createdAt])` | Shop's orders sorted by date |
| ShopFunction | `@@unique([shopId, ruleType])` | One function per rule type per shop |
| WebhookJob | `@@index([status, createdAt])` | Consumer: find pending jobs by creation order |
| WebhookJob | `@@index([status, updatedAt])` | Lease recovery: find stuck processing jobs |
| WebhookJob | `@@index([shopDomain])` | Per-shop queue inspection |
| WebhookConfig | `@@index([shopId, isActive])` | Find active configs for a shop |
| PrivacyRequest | `@@index([shop, createdAt])` | List requests by shop |
| WebhookExecution | `@@index([shop, createdAt])` | Per-shop execution history |

**Design principle**: Avoid single-column indexes on low-cardinality fields (`status`,
`isDeleted`, `plan`). Use composite indexes that match actual query patterns.

---

## Design Decisions

### Why SQLite?

The scaffold defaults to SQLite for zero-config local development. For production:

1. Change `provider` to `"postgresql"` in `schema.prisma`
2. Update `DATABASE_URL` to a PostgreSQL connection string
3. Run `npx prisma migrate dev` to regenerate migrations

### Why Float for Order.amount?

Float is used for cross-database compatibility (SQLite has no Decimal type). For production
PostgreSQL/MySQL, replace with:

```prisma
amount Decimal @db.Decimal(18, 2)
```

And use `BigDecimal` in Java or a decimal library in TypeScript.

### Why JSON Strings?

`WebhookJob.payload`, `WebhookConfig.events`, and `RateLimitCache.state` are stored as
JSON strings instead of native JSON columns. This ensures compatibility across SQLite,
PostgreSQL, and MySQL without provider-specific type annotations.

### Why UUIDs?

All primary keys use UUIDs (except Session, which is SDK-managed). This prevents
enumeration attacks and simplifies multi-tenant data migration.

### Encrypted Fields

| Model | Field | Encryption | Purpose |
|-------|-------|------------|---------|
| Shop | `shopifyToken` | AES-256-GCM | OAuth access token |
| PrivacyRequest | `sealedPayload` | AES-256-GCM | Customer data from GDPR webhooks |
| PrivacyRequest | `confirmedBy` | AES-256-GCM | Actor identity for audit trail |
| WebhookConfig | `secret` | None (HMAC key) | Needs to be readable for signing |
