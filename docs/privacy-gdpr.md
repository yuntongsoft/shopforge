# Privacy & GDPR Architecture

> Shopify mandates GDPR compliance via three webhook topics. ShopForge handles all three
> with encrypted payload storage, merchant confirmation workflow, and automatic retention cleanup.

---

## Table of Contents

1. [Overview](#overview)
2. [Shopify GDPR Webhooks](#shopify-gdpr-webhooks)
3. [Data Model](#data-model)
4. [Request Lifecycle](#request-lifecycle)
5. [Provider Registry](#provider-registry)
6. [Security Design](#security-design)
7. [API Reference](#api-reference)
8. [Compliance Checklist](#compliance-checklist)

---

## Overview

Shopify sends three types of GDPR compliance webhooks. The app **must** respond to all three
within Shopify's requirements — failure to comply can result in app removal from the App Store.

| Webhook | Requirement | ShopForge Behavior |
|---------|-------------|-------------------|
| `CUSTOMERS_DATA_REQUEST` | Export customer PII data | Acknowledge (no customer PII stored) |
| `CUSTOMERS_REDACT` | Delete customer PII data | Acknowledge (no customer PII stored) |
| `SHOP_REDACT` | Delete ALL shop data (hard delete) | Hard-delete shop + all related records |

**Key design decision**: ShopForge stores only shop-level data (domain, encrypted token, plan,
locale). It does NOT store customer PII (names, emails, addresses). Therefore, customer data
requests are acknowledged immediately with no export needed.

If you add customer data storage (e.g., customer segments, purchase history), you MUST implement
export/redact logic in the corresponding handlers.

---

## Shopify GDPR Webhooks

### CUSTOMERS_DATA_REQUEST

```json
{
  "shop_id": 12345,
  "shop_domain": "example.myshopify.com",
  "customer": {
    "id": 67890,
    "email": "customer@example.com"
  },
  "orders_requested": [111, 222, 333]
}
```

**Requirement**: Export all stored data about the customer within the requested scope.

**ShopForge**: Acknowledges receipt. No customer PII is stored, so no export is needed.

### CUSTOMERS_REDACT

```json
{
  "shop_id": 12345,
  "shop_domain": "example.myshopify.com",
  "customer": {
    "id": 67890,
    "email": "customer@example.com"
  },
  "orders_to_redact": [111, 222]
}
```

**Requirement**: Delete all stored customer PII within 30 days.

**ShopForge**: Acknowledges receipt. No customer PII to delete.

### SHOP_REDACT

```json
{
  "shop_id": 12345,
  "shop_domain": "example.myshopify.com"
}
```

**Requirement**: Hard-delete ALL data associated with this shop. This is a legal requirement —
no confirmation needed, no delay allowed.

**ShopForge**: Immediately hard-deletes the Shop record (cascades to Order, ShopFunction,
WebhookConfig via FK) and all Sessions (no FK to Shop, deleted explicitly).

---

## Data Model

```
  PrivacyRequest
  ┌──────────────────────────────────────────────────────────┐
  │ id              UUID PK                                  │
  │ shop            String     shop domain                   │
  │ webhookId       String     X-Shopify-Webhook-Id (dedup) │
  │ kind            String     DATA_REQUEST | REDACT         │
  │ status          String     PENDING → READY → COMPLETED  │
  │                            or REVIEW_REQUIRED            │
  │ sealedPayload   String?    AES-encrypted JSON (nullable) │
  │ expiresAt       DateTime   30-day retention deadline      │
  │ completedAt     DateTime?  when merchant fulfilled        │
  │ confirmedAt     DateTime?  when merchant confirmed        │
  │ confirmedBy     String?    AES-encrypted actor identity   │
  │ createdAt       DateTime                                  │
  │ updatedAt       DateTime                                  │
  │                                                          │
  │ @@unique([shop, webhookId])  idempotent dedup            │
  │ @@index([shop, createdAt])   listing query               │
  └──────────────────────────────────────────────────────────┘
```

---

## Request Lifecycle

```
  Shopify Webhook               Privacy Service                 Merchant
       │                              │                            │
       ├──CUSTOMERS_DATA_REQUEST─────→│                            │
       │                              ├──parse subject             │
       │                              ├──expire stale requests     │
       │                              ├──upsert PrivacyRequest     │
       │                              ├──inspect all providers     │
       │                              ├──status → READY / REVIEW   │
       │←────────200 OK───────────────│                            │
       │                              │                            │
       │                              │   [Merchant opens UI]      │
       │                              │←──list requests────────────│
       │                              │───requests (cursor page)──→│
       │                              │                            │
       │                              │←──export request───────────│
       │                              │───{ results, subject }────→│
       │                              │                            │
       │                              │←──confirm request──────────│
       │                              │───status → COMPLETED──────→│
       │                              │                            │
       │                     [30 days pass]                        │
       │                              │                            │
       │                              ├──expirePrivacyPayloads()   │
       │                              │   sealedPayload → null     │
       │                              │   confirmedBy → null       │
```

### Status Flow

```
  PENDING ──→ READY ──────────→ COMPLETED
     │           │                    ↑
     │           └──→ REVIEW_REQUIRED ┘
     │                    (manual review needed)
     │
     └──→ [expired: sealedPayload cleared]
```

| Status | Meaning |
|--------|---------|
| `PENDING` | Initial state (transient — immediately transitions) |
| `READY` | All providers inspected, no review needed, awaiting merchant |
| `REVIEW_REQUIRED` | At least one provider flagged data needing manual review |
| `COMPLETED` | Merchant confirmed fulfillment |

---

## Provider Registry

The privacy system uses a provider pattern so different data sources can register inspection
logic without modifying the core privacy service.

```typescript
import { registerPrivacyProvider } from "~/services/privacy.server";

// Register a provider that inspects order data
registerPrivacyProvider({
  id: "orders",
  async inspect(shop, subject, redact) {
    const orders = await prisma.order.findMany({
      where: { shopId: shop, id: { in: subject.orderIds } },
    });
    return {
      records: orders,
      reviewRequired: orders.some((o) => o.amount > 10000), // flag large orders
    };
  },
});
```

### Provider Interface

```typescript
interface PrivacyProvider {
  id: string;
  inspect(
    shop: string,
    subject: PrivacySubject,
    redact: boolean
  ): Promise<{
    records: unknown[];
    reviewRequired: boolean;
  }>;
}

interface PrivacySubject {
  customerId?: string;
  email?: string;
  orderIds: string[];
}
```

| Parameter | Description |
|-----------|-------------|
| `shop` | Shop domain (validated) |
| `subject` | Parsed customer/order identifiers from the webhook payload |
| `redact` | `true` for REDACT requests, `false` for DATA_REQUEST |

---

## Security Design

### Encrypted Payload Storage

Privacy request payloads contain customer identifiers (email, customer ID, order IDs). These
are encrypted at rest using AES-256-GCM via the `encrypt()`/`decrypt()` utilities (same
encryption used for access tokens).

```
Webhook payload → parsePrivacySubject() → encrypt(JSON.stringify(subject)) → DB.sealedPayload
DB.sealedPayload → decrypt() → JSON.parse() → PrivacySubject
```

The `confirmedBy` field (actor identity) is also encrypted using the same mechanism.

### Retention & Expiry

- **30-day TTL**: All privacy requests expire after 30 days (`expiresAt = now + 30 * 86400000`).
- **Automatic cleanup**: `expirePrivacyPayloads()` clears `sealedPayload` and `confirmedBy` on
  expired requests. Called at the start of every privacy operation.
- **No data retention**: After expiry, only the request metadata (id, shop, kind, status, dates)
  remains. The encrypted payload is permanently nullified.

### Input Validation

`parsePrivacySubject()` validates all incoming webhook payloads:

| Check | Protection |
|-------|------------|
| Shopify ID format (`/^[1-9]\d*$/`) | Prevents injection via malformed IDs |
| GID prefix stripping (`gid://shopify/Order/123`) | Handles both REST and GraphQL ID formats |
| Max 10,000 order IDs | Prevents DoS via huge payloads |
| Safe integer check (`Number.isSafeInteger`) | Prevents precision loss on large numbers |
| Max 100 chars per ID | Prevents buffer overflow attempts |
| Email max 500 chars | Prevents oversized data storage |

### Shop Domain Validation

All privacy operations call `assertShopDomain()` which validates the domain matches
`/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i` before any database operation.

---

## API Reference

### receivePrivacyRequest()

Process an incoming GDPR webhook. Called by the webhook registry handlers.

```typescript
await receivePrivacyRequest(shop, webhookId, kind, payload);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `shop` | `string` | Shop domain (validated) |
| `webhookId` | `string` | X-Shopify-Webhook-Id for dedup |
| `kind` | `"DATA_REQUEST" \| "REDACT"` | Request type |
| `payload` | `unknown` | Raw webhook payload |

### listPrivacyRequests()

List requests with cursor-based pagination.

```typescript
const { items, nextCursor } = await listPrivacyRequests(shop, cursor);
```

Returns up to 50 items per page. Items ordered by `createdAt DESC, id DESC`.

### exportPrivacyRequest()

Get the full details of a specific request, including provider inspection results.

```typescript
const result = await exportPrivacyRequest(shop, requestId);
// { requestId, kind, subject, reviewRequired, results: [{ provider, records, reviewRequired }] }
```

Throws `Response(404)` if not found, `Response(410)` if expired.

### confirmPrivacyRequest()

Mark a request as completed. Requires the actor's identity for audit trail.

```typescript
const confirmed = await confirmPrivacyRequest(shop, requestId, "admin@example.com");
// true if confirmed, false if already completed or not found
```

---

## Compliance Checklist

Use this checklist when adding new data storage to ShopForge:

- [ ] **Does it store customer PII?** (names, emails, addresses, phone numbers)
  - If YES → implement export logic in `CUSTOMERS_DATA_REQUEST` handler
  - If YES → implement deletion logic in `CUSTOMERS_REDACT` handler
- [ ] **Is it shop-level data only?** (domain, tokens, plan, settings)
  - Already handled by `SHOP_REDACT` (hard delete with FK cascade)
- [ ] **Are payloads encrypted at rest?**
  - Use `encrypt()`/`decrypt()` for any sensitive data stored in DB
- [ ] **Is there a retention policy?**
  - Set `expiresAt` and clear sensitive fields after expiry
- [ ] **Is input validated?**
  - Validate all webhook payload fields before processing
- [ ] **Is the shop domain validated?**
  - Call `assertShopDomain()` before any DB operation
