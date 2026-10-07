# Webhook Resilience Engine

> Three-layer webhook architecture: synchronous registry → async job queue → outbound delivery.
> Handles both inbound (Shopify → app) and outbound (app → merchant) webhook flows.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Module Map](#module-map)
3. [Inbound: Handler Registry](#inbound-handler-registry)
4. [Inbound: Async Job Queue](#inbound-async-job-queue)
5. [Outbound: Event Delivery](#outbound-event-delivery)
6. [Data Flow Diagrams](#data-flow-diagrams)
7. [Configuration Reference](#configuration-reference)
8. [Monitoring & Operations](#monitoring--operations)
9. [Security Considerations](#security-considerations)
10. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

```
                         INBOUND (Shopify → App)
                         ═══════════════════════

  Shopify ──POST──→ /webhooks ──verify──→ webhookRegistry.dispatch()
                                                │
                              ┌─────────────────┴──────────────────┐
                              │                                    │
                     Sync handler (default)              Async handler ({async:true})
                              │                                    │
                     withRetry(2 retries)              enqueueWebhook() → DB
                              │                                    │
                        [completed]                     setImmediate → consume
                                                                │
                                                   ┌────────────┴────────────┐
                                                   │                         │
                                              CAS claim                 Lease recovery
                                              heartbeat                 (cron fallback)
                                                   │                         │
                                              dispatch                 requeue / dead-letter
                                              handlers
                                                   │
                                              [completed / failed]


                         OUTBOUND (App → Merchant)
                         ═════════════════════════

  emitWebhook(shopId, event, payload)
        │
        ├── find WebhookConfig (active, matching event)
        │
        ├── for each config:
        │     ├── validateWebhookUrl() ── SSRF guard
        │     ├── DNS pin resolved IP
        │     ├── HMAC-SHA256 sign body
        │     └── fetch with retry (2 retries, 5s timeout)
        │           Headers: X-Webhook-Signature, X-Webhook-Event, X-Webhook-Delivery
        │
        └── [delivered / failed]
```

---

## Module Map

| File | Purpose | Lines |
|------|---------|-------|
| `services/webhook-registry.ts` | Handler registration + dispatch (sync/async) | ~350 |
| `services/webhook-queue.ts` | Async job queue with CAS claim + lease | ~540 |
| `services/webhook-outbound.ts` | Outbound delivery with SSRF + HMAC | ~330 |
| `routes/webhooks.tsx` | Inbound webhook HTTP endpoint | ~80 |
| `routes/api.webhooks.tsx` | WebhookConfig CRUD API | ~120 |
| `routes/api.cron.tsx` | Cron: queue drain + lease recovery | ~40 |

---

## Inbound: Handler Registry

### Overview

`webhookRegistry` is a singleton `WebhookRegistry` instance. Developers register handlers for Shopify webhook topics; the registry handles dispatch, retry, and async routing.

```typescript
import { webhookRegistry } from "~/services/webhook-registry";

// Sync handler — runs inline during webhook response
webhookRegistry.on("ORDERS_CREATE", async (shop, payload, webhookId) => {
  await updateOrderIndex(shop, payload);
});

// Async handler — enqueued for background processing
webhookRegistry.on("PRODUCTS_UPDATE", async (shop, payload) => {
  await syncProductCatalog(shop, payload);  // may take >5s
}, { async: true });
```

### Sync vs Async

| Aspect | Sync (default) | Async (`{ async: true }`) |
|--------|----------------|--------------------------|
| Execution | Inline during webhook HTTP response | Background queue consumer |
| Timeout | Must complete within ~5s (Shopify limit) | No timeout (lease-based) |
| Retry | `withRetry` — 2 retries, 500ms base delay | Queue retry — 3 attempts, 30s exponential backoff |
| Dedup | None (handler is idempotent by design) | `@@unique([topic, shopDomain, webhookId])` |
| Use case | Lightweight: state updates, cache invalidation | Heavy: Admin API calls, batch operations |

### N² Prevention

When a topic has multiple async handlers, the registry enqueues exactly **once** per dispatch. The queue consumer then runs ALL async handlers for that topic when the job is processed. Without this, N handlers would create N jobs, each running N handlers = N² executions.

```
dispatch("TOPIC") with 3 async handlers:
  ✗ Without guard: enqueue × 3 → consume × 3 → each runs 3 handlers = 9 executions
  ✓ With guard:   enqueue × 1 → consume × 1 → runs 3 handlers = 3 executions
```

### Built-in Handlers

| Topic | Mode | Behavior |
|-------|------|----------|
| `APP_UNINSTALLED` | Async | Delete sessions → soft-delete shop → reset subscription state |
| `APP_SUBSCRIPTIONS_UPDATE` | Sync | Activate/deactivate billing based on status |
| `CUSTOMERS_DATA_REQUEST` | Sync | Acknowledge (no customer PII stored) |
| `CUSTOMERS_REDACT` | Sync | Acknowledge (no customer PII stored) |
| `SHOP_REDACT` | Sync | Hard-delete all shop data (GDPR legal requirement) |

---

## Inbound: Async Job Queue

### Lifecycle

```
  ┌─────────┐    enqueue    ┌─────────┐   CAS claim   ┌─────────────┐
  │ pending  │──────────────→│ pending  │──────────────→│  processing  │
  └─────────┘               └─────────┘               └──────┬──────┘
       ↑                                                      │
       │ retry                                    ┌───────────┴───────────┐
       │ (backoff)                                │                       │
       │                                   [success]                 [failure]
       │                                       │                       │
       │                                       ▼                       ▼
       │                                ┌───────────┐          attempts < MAX?
       └────────────────────────────────│ completed  │           │         │
                                        └───────────┘          Yes        No
                                                                │         │
                                                                ▼         ▼
                                                          ┌────────┐ ┌────────┐
                                                          │ pending │ │ failed │
                                                          └────────┘ └────────┘
                                                          (retry)   (dead-letter)
```

### CAS Claim (Compare-And-Swap)

Jobs are claimed atomically using generation-based ownership. The `attempts` field serves as the generation counter:

```typescript
// Only claim if status is still "pending" AND attempts hasn't changed
const res = await tx.webhookJob.updateMany({
  where: { id: job.id, status: "pending", attempts: job.attempts },
  data: { status: "processing", attempts: { increment: 1 }, updatedAt: new Date() },
});
// res.count === 1 → claimed successfully
// res.count === 0 → another consumer already claimed it
```

This prevents duplicate processing when multiple consumers (or cron + setImmediate) race on the same job.

### Lease & Heartbeat

| Constant | Value | Purpose |
|----------|-------|---------|
| `WEBHOOK_LEASE_MS` | 5 min | Processing timeout — jobs exceeding this can be reclaimed |
| `WEBHOOK_HEARTBEAT_MS` | 60 sec | Heartbeat interval — renews all outstanding jobs |

The heartbeat runs as a `setTimeout` loop (with `.unref()` to avoid blocking process exit) and renews all processing jobs in a single `updateMany` call. If the consumer crashes, the heartbeat stops, and the lease expires — allowing `recoverWebhookJobs()` to requeue.

### Lease Recovery

Called at the start of each batch consumption and by the cron endpoint:

```typescript
const [failed, requeued] = await Promise.all([
  // Exceeded max attempts → dead-letter
  prisma.webhookJob.updateMany({
    where: { status: "processing", updatedAt: { lte: threshold }, attempts: { gte: MAX_ATTEMPTS } },
    data: { status: "failed" },
  }),
  // Still has retries left → back to pending
  prisma.webhookJob.updateMany({
    where: { status: "processing", updatedAt: { lte: threshold }, attempts: { lt: MAX_ATTEMPTS } },
    data: { status: "pending", retryAfter: null },
  }),
]);
```

Both `updateMany` calls are atomic and operate on disjoint sets — no TOCTOU race.

### Exponential Backoff

Failed jobs that still have retries wait with exponential backoff before being consumed again:

```
Attempt 1 fails → retryAfter = now + 30s   (30000 × 2^0)
Attempt 2 fails → retryAfter = now + 60s   (30000 × 2^1)
Attempt 3 fails → status = "failed"        (dead-letter)
```

The consumer filters: `OR: [{ retryAfter: null }, { retryAfter: { lte: new Date() } }]`

### Idempotent Dedup

Shopify retries unacknowledged webhooks with the same `X-Shopify-Webhook-Id`. The queue uses a `@@unique([topic, shopDomain, webhookId])` constraint to catch duplicates. P2002 errors from Prisma are silently ignored — this is the expected dedup path.

### Concurrency Guard

A process-local `consuming` flag prevents parallel batch consumption (e.g., cron + setImmediate firing simultaneously). For multi-instance deployments, the CAS claim provides distributed safety — the guard is just a local optimization.

---

## Outbound: Event Delivery

### Overview

`emitWebhook()` sends event notifications to merchant-configured URLs. Each shop can register multiple `WebhookConfig` records with per-endpoint secrets and event subscriptions.

```typescript
import { emitWebhook, generateWebhookSecret } from "~/services/webhook-outbound";

// Create a webhook config
const secret = generateWebhookSecret();
await prisma.webhookConfig.create({
  data: { shopId, url: "https://merchant.com/hooks", secret, events: JSON.stringify(["rule.created"]) },
});

// Emit an event
await emitWebhook(shopId, "rule.created", { ruleId: "123", name: "Buy 2 Get 1" });
```

### SSRF Protection

The `validateWebhookUrl()` function performs 5 layers of defense:

```
  1. URL format ──────────── Must parse as valid URL
  2. Protocol ────────────── http: or https: only
  3. Port whitelist ──────── 80, 443, 8080, 8443, 3000, 5000
  4. Hostname check ──────── Reject localhost, .local, .internal
  5. DNS resolution ──────── Resolve → isPrivateIp() on all addresses
```

**Private IP ranges blocked:**

| Range | CIDR | Description |
|-------|------|-------------|
| 10.0.0.0/8 | 10.x.x.x | Private Class A |
| 127.0.0.0/8 | 127.x.x.x | Loopback |
| 0.0.0.0/8 | 0.x.x.x | Current network |
| 169.254.0.0/16 | 169.254.x.x | Link-local |
| 172.16.0.0/12 | 172.16-31.x.x | Private Class B |
| 192.168.0.0/16 | 192.168.x.x | Private Class C |
| 100.64.0.0/10 | 100.64-127.x.x | CGNAT |
| ::1 | IPv6 loopback | IPv6 loopback |
| fe80::/10 | IPv6 link-local | IPv6 link-local |
| fc00::/7 | IPv6 ULA | IPv6 unique local |

IPv6-mapped IPv4 addresses (`::ffff:192.168.1.1`) are recursively validated.

### DNS Pinning

After validation, the resolved IP is **pinned** — the fetch connects to the IP directly, not the hostname. This prevents DNS rebinding attacks where a domain resolves to a public IP during validation but switches to a private IP during the actual connection.

```typescript
const pinnedUrl = new URL(config.url);
pinnedUrl.hostname = check.pinnedIp;  // Connect to validated IP

// For HTTPS: preserve original hostname for TLS cert verification
const dispatcher = new Agent({ connect: { servername: check.hostname } });
```

The `undici.Agent` with `servername` ensures TLS SNI uses the original hostname for correct certificate verification.

### HMAC-SHA256 Signing

Each delivery is signed with the config's secret so recipients can verify authenticity:

```
X-Webhook-Signature: sha256=<hex>
```

Recipient verification:

```javascript
const crypto = require("crypto");
const hmac = crypto.createHmac("sha256", secret).update(requestBody).digest("hex");
const isValid = crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
```

### Delivery Headers

| Header | Purpose |
|--------|---------|
| `X-Webhook-Signature` | `sha256=<hex>` — HMAC-SHA256 of request body |
| `X-Webhook-Event` | Event type string (e.g., `rule.created`) |
| `X-Webhook-Delivery` | Unique delivery ID (UUID) for dedup/tracing |

### Retry Behavior

Each delivery uses `withRetry` with 2 retries and 1s base delay. Combined with the 5s timeout per attempt, worst case is ~15s per config. The `finally` block closes the undici Agent to prevent socket leaks.

---

## Data Flow Diagrams

### Inbound Webhook (Sync Path)

```
  Shopify                  App                        DB
    │                       │                          │
    ├──POST /webhooks──────→│                          │
    │                       ├──verify HMAC─────────────→│
    │                       │                          │
    │                       ├──dispatch(topic)─────────→│
    │                       │   └─ handler(shop,payload)│
    │                       │                          │
    │←────200 OK────────────│                          │
```

### Inbound Webhook (Async Path)

```
  Shopify                  App                        DB
    │                       │                          │
    ├──POST /webhooks──────→│                          │
    │                       ├──verify HMAC─────────────→│
    │                       │                          │
    │                       ├──enqueueWebhook()────────→│ INSERT (pending)
    │                       │                          │
    │←────200 OK────────────│                          │
    │                       │                          │
    │                  [setImmediate]                  │
    │                       │                          │
    │                       ├──consumeBatch()──────────→│ CAS: pending→processing
    │                       │   └─ dispatchHandlers()  │
    │                       │                          │
    │                       ├──mark completed──────────→│ UPDATE status
```

### Outbound Webhook

```
  Service                  App                        Merchant
    │                       │                            │
    ├──emitWebhook()───────→│                            │
    │                       ├──find configs──────────────│
    │                       │                            │
    │                       ├──validateUrl()──SSRF guard │
    │                       ├──DNS pin IP                │
    │                       ├──sign body (HMAC)          │
    │                       │                            │
    │                       ├──POST─────────────────────→│
    │                       │  X-Webhook-Signature       │
    │                       │  X-Webhook-Event           │
    │                       │  X-Webhook-Delivery        │
    │                       │                            │
    │                       │←────200 OK─────────────────│
    │                       │  [or retry on failure]     │
```

---

## Configuration Reference

### Queue Constants

| Constant | Value | Override | Description |
|----------|-------|----------|-------------|
| `MAX_ATTEMPTS` | 3 | — | Max processing attempts before dead-letter |
| `BATCH_LIMIT` | 20 | — | Max jobs per batch consumption |
| `WEBHOOK_LEASE_MS` | 5 min | — | Processing lease timeout |
| `WEBHOOK_HEARTBEAT_MS` | 60 sec | — | Heartbeat renewal interval |
| `BACKOFF_BASE_MS` | 30 sec | — | Retry backoff base (Nth failure: BASE × 2^(N-1)) |

### Outbound Delivery

| Aspect | Value |
|--------|-------|
| Delivery timeout | 5 seconds per attempt |
| Max retries | 2 (exponential backoff, 1s base) |
| Port whitelist | 80, 443, 8080, 8443, 3000, 5000 |
| Protocols | http, https |

### Event Types

Built-in event types with autocomplete, plus arbitrary string support:

```typescript
type WebhookEvent =
  | "rule.created"
  | "rule.updated"
  | "rule.deleted"
  | "rule.triggered"
  | "ab_test.complete"
  | "quota.warning"
  | (string & Record<string, never>);
```

---

## Monitoring & Operations

### Queue Stats

```typescript
import { getQueueStats } from "~/services/webhook-queue";

const stats = await getQueueStats();
// { pending: 3, processing: 1, completed: 142, failed: 2 }
```

### Dead-Letter Inspection

```typescript
import { getDeadLetters, retryDeadLetter } from "~/services/webhook-queue";

// List failed jobs
const dead = await getDeadLetters(50);
// [{ id, topic, shopDomain, payload, attempts, lastError, createdAt }]

// Retry a specific job
await retryDeadLetter(jobId);  // resets attempts to 0, status to pending
```

### Cron Endpoints

| Endpoint | Purpose | Frequency |
|----------|---------|-----------|
| `POST /api/cron` | Drain webhook queue backlog | Every 1-5 min |
| `GET /api/health` | Queue stats in health check | Every 30 sec |

The cron endpoint calls `consumeWebhookBatch()` which first runs `recoverWebhookJobs()` to reclaim any stuck jobs from crashed consumers.

### Cleanup

```typescript
import { cleanupWebhookJobs } from "~/services/webhook-queue";

// Delete completed/failed jobs older than 7 days
const deleted = await cleanupWebhookJobs();
```

---

## Security Considerations

### Inbound

- **HMAC verification**: All inbound webhooks are verified against `SHOPIFY_API_SECRET` before dispatch. Unverified payloads are rejected with 401.
- **Idempotency**: The `webhookId` dedup constraint prevents duplicate processing from Shopify retries.

### Outbound

- **SSRF protection**: 5-layer validation blocks delivery to private/internal networks.
- **DNS pinning**: Prevents DNS rebinding by connecting to the validated IP directly.
- **HMAC signing**: Recipients can verify payload authenticity with their configured secret.
- **Secret generation**: `generateWebhookSecret()` uses `crypto.randomBytes(32)` (256 bits of entropy).

### General

- **No raw payload logging**: Payloads may contain merchant data; log only metadata (topic, shop, job ID).
- **Socket cleanup**: The undici Agent is closed in `finally` to prevent socket leaks on error paths.

---

## Troubleshooting

| Symptom | Cause | Resolution |
|---------|-------|------------|
| Jobs stuck in `processing` | Consumer crashed without completing | Cron calls `recoverWebhookJobs()` to reclaim |
| Duplicate job execution | Multiple async handlers without N² guard | Fixed: registry enqueues once per topic |
| Webhook returns 500 to Shopify | Handler threw before enqueue | Check handler registration; fallback executes sync |
| Outbound delivery fails silently | SSRF guard blocked the URL | Check logs for "SSRF guard" — URL may resolve to private IP |
| Dead-letter jobs accumulating | Handler consistently failing | Inspect with `getDeadLetters()`, fix handler, `retryDeadLetter()` |
| Heartbeat not renewing | Consumer blocked on synchronous operation | Ensure handlers are async; heartbeat runs on separate timer |
| P2002 errors in logs | Duplicate webhook from Shopify retry | Expected behavior — idempotent dedup working correctly |
| Socket leak / EMFILE | undici Agent not closed on error | Fixed: `finally` block closes dispatcher |
