# Shopify API Rate Limiter — Architecture Document

> Module: `app/services/shopify-rate-limiter.ts`
> Author: yuntongsoft | Date: 2026-10-07
> Tests: `tests/services/shopify-rate-limiter.test.ts` (59 tests)

---

## 1. Overview

This module implements an adaptive rate limit layer for the Shopify Admin API. Shopify uses a **leaky bucket algorithm** with a capacity of ~1000 calls and a refill rate of ~50 calls/second. The `X-Shopify-Shop-Api-Call-Limit` response header reports current bucket usage as `{used}/{capacity}`.

The rate limiter tracks this state per-shop and applies **adaptive delays** to avoid hitting 429 errors, rather than reacting after the fact.

### Core Capabilities

| Feature | Description |
|---------|-------------|
| Adaptive Delay | Continuous delay curve via linear interpolation — smooth ramp instead of fixed zone jumps |
| Circuit Breaker | Opens after consecutive 429s, blocks requests immediately until cooldown expires |
| Multi-Process Sync | Redis primary + DB fallback chain for cross-process state sharing |
| Bucket Decay | Estimates current usage by accounting for leaky bucket refill during idle time |
| In-Flight Tracking | Accounts for requests in-flight between acquire and response arrival |
| Per-Shop Isolation | Each shop has independent rate limits, circuits, and metrics |
| Monitoring | Exposes telemetry via `getMetrics()`, `getStats()`, `getHealth()` |

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        _core.ts (GraphQL Client)                    │
│                                                                     │
│  acquire(shop) → fetch() → track(shop, res) → [429?] → release()  │
│       ↑                            ↑              ↑                 │
│       │                            │              │                 │
│       │                     handle429()    recordSuccess()          │
└───────┼────────────────────────────┼──────────────┼─────────────────┘
        │                            │              │
        ▼                            ▼              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   ShopifyRateLimitTracker (Singleton)                │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ states (Map) │  │circuits(Map) │  │   metrics (counters)     │  │
│  │ per-shop     │  │ per-shop     │  │   totalRequests          │  │
│  │ InternalState│  │ CircuitState │  │   total429s              │  │
│  └──────┬───────┘  └──────────────┘  │   totalDelays            │  │
│         │                            │   totalDelayMs           │  │
│         │                            │   circuitBreakerTrips    │  │
│         ▼                            └──────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    persistState()                            │  │
│  │                                                              │  │
│  │   Redis available? ──yes──→ writeToRedis() ──fail──┐        │  │
│  │        │                                           │        │  │
│  │       no                                         fallback  │  │
│  │        │                                           │        │  │
│  │        └──────────────→ writeToDb() ←──────────────┘        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    syncFromRemote()                          │  │
│  │                                                              │  │
│  │   readFromRedis() ──miss──→ readFromDb() ──merge──→ state   │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Delay Curve Algorithm

### 3.1 Continuous Interpolation

Instead of fixed zone boundaries with step-function delays, the module uses **linear interpolation** between breakpoints:

```
Default curve: [50%, 0ms] → [70%, 50ms] → [80%, 200ms] → [90%, 600ms] → [95%, 1200ms] → [100%, 2000ms]

Usage:  0%────50%────70%────80%────90%────95%────100%
Delay:   0ms    0ms   50ms  200ms  600ms 1200ms  2000ms
         └──────┘─────┘─────┘──────┘──────┘──────┘
          green    linear interpolation →→→→→→→→→→
         (no      (smooth ramp)
         delay)
```

### 3.2 Zone Labels (Logging Only)

Zone labels are derived from usage percent for **human-readable logging only**. The actual delay always comes from `computeDelay()`:

| Zone | Usage Range | Typical Delay |
|------|-------------|---------------|
| green | < 60% | 0 ms |
| yellow | 60% – 80% | 0 – 200 ms |
| orange | 80% – 90% | 200 – 600 ms |
| red | > 90% | 600 – 2000 ms |

### 3.3 Priority Override

Requests with `priority: "critical"` skip yellow zone delays but still respect orange/red delays. Use this for time-sensitive operations that must not be throttled at moderate usage levels.

---

## 4. Circuit Breaker

### 4.1 State Machine

```
                    ┌─────────────────────────────┐
                    │                             │
                    ▼                             │
    ┌────────┐  threshold   ┌────────┐  success  ┌───────────┐
    │ CLOSED │ ──────────→  │  OPEN  │ ────────→ │ HALF_OPEN │
    └────────┘              └────────┘           └───────────┘
        ▲                       │                      │
        │                       │ cooldown             │ 429
        │                       ▼                      │
        │                  (allow probe)               │
        │                       │                      │
        └───────────────────────┴──────────────────────┘
```

### 4.2 Configuration

| Parameter | Default | Env Var | Description |
|-----------|---------|---------|-------------|
| Threshold | 5 | `RATE_LIMIT_CB_THRESHOLD` | Consecutive 429s within window before circuit opens |
| Window | 60s | `RATE_LIMIT_CB_WINDOW_MS` | Sliding window for counting consecutive 429s |
| Cooldown | 30s | `RATE_LIMIT_CB_COOLDOWN_MS` | How long circuit stays open before allowing a probe |

### 4.3 Behavior

- **CLOSED**: Normal operation. Every 429 increments the counter.
- **OPEN**: All `acquire()` calls throw immediately. After cooldown expires, transitions to HALF_OPEN.
- **HALF_OPEN**: One probe request is allowed. Success → CLOSED. Failure (429) → OPEN.

---

## 5. Data Flow

### 5.1 Request Lifecycle

```
1. acquire(shop)
   ├── Circuit breaker check → throw if OPEN and cooldown not expired
   ├── Sync from remote (Redis → DB) if local state missing or stale (>5s)
   ├── Check blockedUntil → sleep if 429 backoff active
   ├── Check staleness → skip delay if no update for 30s+
   ├── Estimate current usage (apply leaky bucket decay)
   ├── Compute delay via interpolation curve
   ├── Sleep if delay > 0
   └── Increment inFlight counter

2. fetch(url, options)
   └── (Shopify API call)

3. track(shop, response)
   ├── Parse X-Shopify-Shop-Api-Call-Limit header
   ├── Update local state (used, capacity, lastUpdate)
   ├── Decrement inFlight (response arrived)
   ├── Log warning if orange/red zone
   └── Persist state (Redis → DB fallback, fire-and-forget)

4a. If 429: handle429(shop, response)
    ├── Parse Retry-After header (default 2s)
    ├── Set blockedUntil timestamp
    ├── Preserve used/capacity from preceding track()
    ├── Update circuit breaker (increment consecutive 429s)
    └── Persist state (fire-and-forget)

4b. If success: recordSuccess(shop)
    └── Reset circuit breaker to CLOSED

5. release(shop)  [in finally block]
    └── Decrement inFlight counter
```

### 5.2 Bucket Decay Estimation

When no response has arrived for a while, the module estimates current bucket usage by assuming Shopify's leaky bucket has been refilling:

```
estimatedUsed = max(0, lastUsed - (elapsedSec × refillRate) + inFlight)
```

- `refillRate`: 50 calls/sec (Shopify default, configurable)
- `inFlight`: requests that have been acquire'd but not yet track'd

If no update for 30s+ (`STALE_THRESHOLD_MS`), the bucket is assumed fully refilled and delays are skipped.

---

## 6. Persistence Architecture

### 6.1 Three-Tier Storage

| Tier | Storage | Read Latency | Write Latency | Scope |
|------|---------|--------------|---------------|-------|
| L1 | In-memory `Map` | ~0 ns | ~0 ns | Single process |
| L2 | Redis | ~1 ms | ~1 ms | Cross-process |
| L3 | PostgreSQL (Prisma) | ~5 ms | ~5 ms | Cross-process (fallback) |

### 6.2 Write Path (persistState)

```
persistState(shop, state)
  ├── Redis available?
  │     ├── yes → writeToRedis()
  │     │          ├── success → done (skip DB to reduce load)
  │     │          └── failure → writeToDb() (fallback)
  │     └── no  → writeToDb()
  └── (fire-and-forget — caller does not await)
```

**Key design decision**: When Redis is healthy, DB writes are skipped entirely. This avoids the overhead of dual-writes on every API response while ensuring data is persisted *somewhere* for cross-process sharing.

### 6.3 Read Path (syncFromRemote)

```
syncFromRemote(shop)
  ├── readFromRedis()
  │     ├── hit → merge into local state (preserve inFlight)
  │     └── miss → readFromDb()
  │                  ├── hit → merge into local state
  │                  └── miss → no-op
  └── (only called when local state is missing or >5s stale)
```

### 6.4 Schema Validation

Both Redis and DB reads validate the schema before accepting data:

```typescript
if (typeof parsed.used !== "number" || typeof parsed.capacity !== "number") {
  logger.warn({ shop }, "Invalid schema, ignoring");
  return null;
}
```

This prevents corrupted or incompatible data from crashing the rate limiter.

### 6.5 TTL and Expiry

| Storage | TTL | Key Format |
|---------|-----|------------|
| Redis | 300s | `shopify-ratelimit:{shop}` |
| DB | 300s (expiresAt column) | `shopDomain` (unique) |

Expired data is ignored on read and eventually cleaned up by Redis TTL / DB TTL column.

---

## 7. Configuration Reference

All parameters can be overridden via environment variables at startup:

| Env Var | Default | Type | Description |
|---------|---------|------|-------------|
| `RATE_LIMIT_DELAY_CURVE` | `[[50,0],[70,50],[80,200],[90,600],[95,1200],[100,2000]]` | JSON array | Delay curve breakpoints `[usagePercent, delayMs]` |
| `RATE_LIMIT_REFILL_RATE` | `50` | number | Shopify leaky bucket refill rate (calls/sec) |
| `RATE_LIMIT_STALE_THRESHOLD_MS` | `30000` | number | Stale state threshold — skip delay if no update for this long |
| `RATE_LIMIT_CB_THRESHOLD` | `5` | number | Consecutive 429s before circuit opens |
| `RATE_LIMIT_CB_WINDOW_MS` | `60000` | number | Sliding window for counting consecutive 429s |
| `RATE_LIMIT_CB_COOLDOWN_MS` | `30000` | number | Open circuit cooldown before allowing probe |
| `REDIS_URL` | (none) | string | Redis connection URL. If unset, falls back to DB only |

### Delay Curve Format

The delay curve is a JSON array of `[usagePercent, delayMs]` pairs. Linear interpolation between points gives a smooth ramp. Below the first point, delay is 0. Above the last point, delay is capped at the last value.

Example — aggressive curve for high-volume shops:
```bash
RATE_LIMIT_DELAY_CURVE='[[30,0],[50,100],[70,500],[85,1500],[95,3000],[100,5000]]'
```

---

## 8. Integration Pattern

### 8.1 Usage in _core.ts

```typescript
import { shopifyRateLimiter } from "~/services/shopify-rate-limiter";

// Inside the GraphQL client:
await shopifyRateLimiter.acquire(shopDomain);

try {
  const response = await fetch(url, { /* ... */ });

  // Track rate limit state from response headers (always, including 429)
  shopifyRateLimiter.track(shopDomain, response);

  if (response.status === 429) {
    shopifyRateLimiter.handle429(shopDomain, response);
    throw new Error("Rate limit exceeded");
  }

  // Success — reset circuit breaker
  shopifyRateLimiter.recordSuccess(shopDomain);

  return response.json();
} finally {
  // Always release — even on error
  shopifyRateLimiter.release(shopDomain);
}
```

### 8.2 Call Order Contract

The integration follows a strict call order:

1. `acquire()` — before the fetch
2. `track()` — after the response (including 429 responses)
3. `handle429()` — only if status is 429 (after track)
4. `recordSuccess()` — only if status is not 429
5. `release()` — in `finally` block (always)

**Important**: `track()` must be called before `handle429()`. The `handle429()` method preserves the `used`/`capacity` values set by `track()` and only updates `blockedUntil`.

---

## 9. Monitoring

### 9.1 Metrics

```typescript
const metrics = shopifyRateLimiter.getMetrics();
// {
//   totalRequests: 1523,       // requests that passed circuit breaker
//   total429s: 12,             // 429 responses received
//   totalDelays: 89,           // times a delay was applied
//   totalDelayMs: 45200,       // cumulative delay time
//   circuitBreakerTrips: 2,    // times circuit opened
//   since: 1696700000000       // metrics reset timestamp
// }
```

### 9.2 Per-Shop Health

```typescript
const health = await shopifyRateLimiter.getHealth("mystore.myshopify.com");
// {
//   rateLimit: {
//     used: 450,
//     capacity: 1000,
//     usagePercent: 45,
//     zone: "green",
//     delayMs: 0,
//     lastUpdate: 1696700123456,
//     blockedUntil: 0
//   },
//   circuit: {
//     state: "closed",
//     consecutive429s: 0,
//     openedAt: 0,
//     last429At: 0
//   }
// }
```

### 9.3 All Shops Stats

```typescript
const stats = await shopifyRateLimiter.getStats();
// Returns Record<shopDomain, RateLimitState> for all tracked shops
```

---

## 10. Operational Guidance

### 10.1 Memory Management

- Maximum 5000 shops tracked in memory (`MAX_SHOPS`). When exceeded, the oldest (by `lastUpdate`) is evicted via LRU.
- Eviction also cleans up Redis and DB entries for the evicted shop.

### 10.2 Redis Failure Modes

| Scenario | Behavior |
|----------|----------|
| `REDIS_URL` not set | DB-only mode. All reads/writes go to PostgreSQL. |
| Redis connection fails at startup | Falls back to DB. Warning logged once. |
| Redis write fails at runtime | Falls back to DB for that write. Warning logged. |
| Redis read fails | Falls back to DB. Warning logged. |
| Redis data corrupted | Schema validation rejects it. Falls back to DB. |

### 10.3 Tuning for High-Volume Shops

For shops making > 500 API calls/minute, consider:

1. **Aggressive delay curve**: Lower the threshold and increase delays
   ```bash
   RATE_LIMIT_DELAY_CURVE='[[30,0],[50,100],[70,500],[85,1500],[100,3000]]'
   ```

2. **Lower circuit breaker threshold**: Trip earlier to protect the shop
   ```bash
   RATE_LIMIT_CB_THRESHOLD=3
   ```

3. **Ensure Redis is available**: Cross-process sync prevents multiple workers from independently exhausting the bucket.

### 10.4 Troubleshooting

| Symptom | Likely Cause | Action |
|---------|-------------|--------|
| Frequent 429s | Delay curve too conservative | Lower first breakpoint, increase delays |
| High latency, few 429s | Delay curve too aggressive | Raise first breakpoint, decrease delays |
| Circuit breaker trips often | Shopify bucket consistently exhausted | Investigate bulk operations, reduce concurrency |
| "Redis write failed" logs | Redis connection issue | Check `REDIS_URL`, Redis server health |
| State resets between requests | No Redis, DB writes failing | Check DB connectivity, Prisma logs |

---

## 11. Testing

The module has 59 tests covering:

- Header parsing (valid, invalid, null, malformed)
- State tracking (single shop, multi-shop, no header)
- Zone calculation (green, yellow, orange, red)
- 429 handling (Retry-After, default, blocking, state preservation)
- Priority (critical skips yellow, not orange/red)
- Bucket decay (stale state skip, refill estimation)
- In-flight tracking (increment, decrement, estimation)
- Circuit breaker (threshold, open state, half_open probe, recovery, per-shop isolation)
- Persistence (Redis→DB fallback, schema validation, LRU eviction, no dual-write)
- Metrics (counter accuracy, reset)

Run tests:
```bash
npx vitest run tests/services/shopify-rate-limiter.test.ts
```

---

## 12. File Structure

```
app/services/
├── shopify-rate-limiter.ts    # This module (815 lines)
└── shopify/
    └── _core.ts               # Integration point (GraphQL client)

prisma/schema.prisma           # RateLimitCache model

tests/services/
└── shopify-rate-limiter.test.ts  # 59 tests
```
