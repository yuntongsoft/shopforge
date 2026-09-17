# Services API Reference

> **Author:** yuntongsoft  
> **Created:** 2026/08/01  
> **Last Updated:** 2026/09/17

Method-level documentation for all service modules. Each entry includes signature, parameters, return type, and usage example.

---

## Table of Contents

- [shopifyAdmin() — Shopify Admin API](#shopifyadmin--shopify-admin-api)
- [billingService — Billing API](#billingservice--billing-api)
- [webhookRegistry — Webhook Management](#webhookregistry--webhook-management)
- [email — Transactional Email](#email--transactional-email)

---

## shopifyAdmin() — Shopify Admin API

**File:** `app/services/shopify/index.ts`
**Purpose:** High-level facade over Shopify GraphQL Admin API. Hides all GraphQL complexity behind simple method calls.

### Factory

```typescript
import { shopifyAdmin } from "~/services/shopify";

const api = shopifyAdmin("example.myshopify.com");
```

| Param | Type | Description |
|-------|------|-------------|
| `shopDomain` | `string` | Shopify shop domain (e.g. `"example.myshopify.com"`) |

**Returns:** An API object with all methods below, bound to the given shop.

---

### Products

#### `api.getProducts(options?)`

Fetch a paginated list of products.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options.first` | `number` | `20` | Items per page (max 250) |
| `options.after` | `string` | — | Cursor for next page (from `endCursor`) |
| `options.query` | `string` | — | Shopify search query (e.g. `"status:ACTIVE"`) |

**Returns:** `PaginatedResult<ShopifyProduct>`

```typescript
const result = await api.getProducts({ first: 10, query: "vendor:Acme" });
// result.items: ShopifyProduct[]
// result.hasNextPage: boolean
// result.endCursor: string | undefined
```

#### `api.getAllProducts(query?)`

Fetch ALL products across all pages. Safety limit: max 20 pages (1000 products).

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `query` | `string` | — | Optional search query |

**Returns:** `ShopifyProduct[]`

```typescript
const allProducts = await api.getAllProducts("status:ACTIVE");
```

#### `ShopifyProduct` shape

```typescript
{
  id: string;           // GraphQL GID (e.g. "gid://shopify/Product/123")
  title: string;
  handle: string;       // URL-safe slug
  status: string;       // "ACTIVE" | "ARCHIVED" | "DRAFT"
  vendor: string;
  productType: string;
  image?: string;       // First image URL (undefined if none)
  variants: Array<{
    id: string;
    title: string;
    price: string;      // e.g. "19.99"
    compareAtPrice?: string;
    sku: string;
    inventoryQuantity: number;
  }>;
}
```

---

### Collections

#### `api.getCollections(options?)`

List collections with product count.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options.first` | `number` | `50` | Max items |
| `options.query` | `string` | — | Search query |

**Returns:** `ShopifyCollection[]`

```typescript
const collections = await api.getCollections({ first: 10 });
// [{ id, title, handle, productsCount }]
```

#### `api.getCollectionProducts(collectionId, first?)`

Get products within a specific collection.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `collectionId` | `string` | — | GraphQL GID of the collection |
| `first` | `number` | `20` | Max items |

**Returns:** `Array<{ id: string; title: string; image?: string }>`

```typescript
const products = await api.getCollectionProducts("gid://shopify/Collection/456");
```

---

### Orders

#### `api.getOrders(options?)`

Fetch paginated orders with optional date filter.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options.first` | `number` | `20` | Items per page |
| `options.after` | `string` | — | Pagination cursor |
| `options.query` | `string` | — | Search query |
| `options.days` | `number` | — | Only orders from last N days |

**Returns:** `PaginatedResult<ShopifyOrder>`

```typescript
const recent = await api.getOrders({ days: 7, first: 50 });
// recent.items: ShopifyOrder[]
```

#### `api.getRecentOrders(days?)`

Convenience: get recent orders (default: last 7 days, max 50).

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | `number` | `7` | Time window in days |

**Returns:** `ShopifyOrder[]`

```typescript
const orders = await api.getRecentOrders(14); // last 2 weeks
```

#### `api.getOrderStats(days?)`

Aggregate order statistics over a time window. Uses integer-cent accumulation to avoid floating-point precision loss. Safety limit: max 10 pages (2500 orders).

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `days` | `number` | `30` | Time window in days |

**Returns:** `{ totalOrders: number; totalRevenue: number }`

```typescript
const stats = await api.getOrderStats(30);
// { totalOrders: 142, totalRevenue: 28450.50 }
```

#### `ShopifyOrder` shape

```typescript
{
  id: string;
  name: string;            // e.g. "#1001"
  email: string;
  totalPrice: string;      // e.g. "125.00"
  currency: string;        // e.g. "USD"
  financialStatus: string; // "PAID" | "PENDING" | "REFUNDED" | ...
  fulfillmentStatus: string; // "FULFILLED" | "UNFULFILLED" | "PARTIAL"
  createdAt: string;       // ISO 8601
  lineItems: Array<{
    id: string;
    title: string;
    quantity: number;
    price: string;
  }>;
}
```

---

### Shop

#### `api.getShopInfo()`

Get current shop metadata. No parameters.

**Returns:** `ShopifyShopInfo`

```typescript
const info = await api.getShopInfo();
// { name, email, domain, myshopifyDomain, plan, currency, timezone }
```

#### `ShopifyShopInfo` shape

```typescript
{
  name: string;           // Shop display name
  email: string;          // Shop owner email
  domain: string;         // Custom domain (empty if none)
  myshopifyDomain: string; // e.g. "example.myshopify.com"
  plan: string;           // e.g. "Shopify", "Basic Shopify"
  currency: string;       // e.g. "USD"
  timezone: string;       // e.g. "America/New_York"
}
```

---

### Customers

#### `api.getCustomers(options?)`

List customers with optional search.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `options.first` | `number` | `20` | Max items |
| `options.query` | `string` | — | Search query (e.g. `"email:john@example.com"`) |

**Returns:** `Array<{ id, displayName, email, numberOfOrders, totalSpent }>`

```typescript
const customers = await api.getCustomers({ first: 10, query: "tag:vip" });
```

---

### Metafields

#### `api.getMetafields(ownerType, namespace, ownerId?)`

List metafields for any owner type.

| Param | Type | Description |
|-------|------|-------------|
| `ownerType` | `"SHOP" \| "PRODUCT" \| "ORDER" \| "CUSTOMER"` | Resource type |
| `namespace` | `string` | Metafield namespace |
| `ownerId` | `string` | GraphQL GID of the owner (optional for shop-level) |

**Returns:** `Array<{ id, key, value, type, namespace }>`

```typescript
const metafields = await api.getMetafields("SHOP", "custom", undefined);
```

#### `api.setMetafield(ownerId, namespace, key, value, type?)`

Create or update a metafield on any resource.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `ownerId` | `string` | — | GraphQL GID |
| `namespace` | `string` | — | Namespace |
| `key` | `string` | — | Metafield key |
| `value` | `string` | — | Value |
| `type` | `string` | `"SINGLE_LINE_TEXT_FIELD"` | Shopify metafield type |

**Returns:** `void`

```typescript
await api.setMetafield(
  "gid://shopify/Product/123",
  "custom",
  "badge",
  "Best Seller",
  "SINGLE_LINE_TEXT_FIELD"
);
```

#### `api.getShopMetafield(namespace, key)`

Get a single shop-level metafield value.

**Returns:** `string | null`

```typescript
const value = await api.getShopMetafield("custom", "theme_color");
// "#008060" or null if not set
```

#### `api.setShopMetafield(namespace, key, value, type?)`

Set a shop-level metafield. Auto-fetches shop ID.

**Returns:** `void`

```typescript
await api.setShopMetafield("custom", "theme_color", "#008060");
```

---

### GraphQL Escape Hatch

#### `api.graphql<T>(query, variables?)`

Raw GraphQL query for operations not covered by the facade.

```typescript
const data = await api.graphql<{ shop: { name: string } }>(
  `{ shop { name } }`
);
```

---

## billingService — Billing API

**File:** `app/services/billing.service.ts`
**Purpose:** Shopify Billing API — subscription CRUD, plan management.

```typescript
import { billingService, BILLING_PLANS } from "~/services/billing.service";
```

### Constants

#### `BILLING_PLANS`

```typescript
{
  free:     { name: "Free",     price: 0,     interval: "EVERY_30_DAYS", trialDays: 0 },
  pro:      { name: "Pro",      price: 9.99,  interval: "EVERY_30_DAYS", trialDays: 7 },
  business: { name: "Business", price: 29.99, interval: "EVERY_30_DAYS", trialDays: 7 },
}
```

---

### Methods

#### `billingService.getShopPlan(shopId)`

Get the current plan for a shop.

| Param | Type | Description |
|-------|------|-------------|
| `shopId` | `string` | Shop UUID (from `Shop.id`) |

**Returns:** `Promise<PlanName>` — `"free" | "pro" | "business"`

```typescript
const plan = await billingService.getShopPlan(shopId);
// "free" | "pro" | "business"
```

#### `billingService.createSubscription(shopDomain, planName, accessToken)`

Create a Shopify subscription via GraphQL. Returns confirmation URL for the merchant to approve.

| Param | Type | Description |
|-------|------|-------------|
| `shopDomain` | `string` | e.g. `"example.myshopify.com"` |
| `planName` | `PlanName` | `"pro"` or `"business"` |
| `accessToken` | `string` | Shop's OAuth access token |

**Returns:** `Promise<{ confirmationUrl: string } | { error: string }>`

```typescript
const result = await billingService.createSubscription(shop, "pro", token);
if ("confirmationUrl" in result) {
  // Redirect merchant to result.confirmationUrl to approve
} else {
  // Handle result.error
}
```

#### `billingService.handleSubscriptionActivated(shop, name, status)`

Handle `APP_SUBSCRIPTIONS_UPDATE` webhook when subscription becomes active. Called internally by webhook registry.

| Param | Type | Description |
|-------|------|-------------|
| `shop` | `string` | Shop domain |
| `name` | `string` | Plan name from Shopify |
| `status` | `string` | `"ACTIVE"` or `"ACCEPTED"` |

**Returns:** `Promise<void>`

#### `billingService.handleSubscriptionDeactivated(shop)`

Handle subscription cancellation/decline/expire. Downgrades shop to free plan.

| Param | Type | Description |
|-------|------|-------------|
| `shop` | `string` | Shop domain |

**Returns:** `Promise<void>`

---

## webhookRegistry — Webhook Management

**File:** `app/services/webhook-registry.ts`
**Purpose:** Centralized webhook handler registry. Developers register handlers; the framework handles delivery, retry, and HMAC verification.

```typescript
import { webhookRegistry } from "~/services/webhook-registry";
```

### Methods

#### `webhookRegistry.on(topic, handler)`

Register a handler for a webhook topic. Multiple handlers per topic are supported (called in registration order).

| Param | Type | Description |
|-------|------|-------------|
| `topic` | `WebhookTopic` | e.g. `"ORDERS_CREATE"`, `"APP_UNINSTALLED"` |
| `handler` | `WebhookHandler` | `(shop: string, payload: unknown) => void \| Promise<void>` |

```typescript
webhookRegistry.on("ORDERS_CREATE", async (shop, payload) => {
  const order = payload as { name: string };
  console.log(`New order: ${order.name} from ${shop}`);
});
```

#### `webhookRegistry.dispatch(topic, shop, payload)`

Dispatch a webhook to all registered handlers. Called by `routes/webhooks.tsx`. Includes retry with exponential backoff (max 2 retries, 500ms → 2s).

| Param | Type | Description |
|-------|------|-------------|
| `topic` | `string` | Webhook topic |
| `shop` | `string` | Shop domain |
| `payload` | `unknown` | Webhook payload |

**Returns:** `Promise<boolean>` — `true` if at least one handler was found.

#### `webhookRegistry.getRegisteredTopics()`

Get all registered topics. Used by `shopify.server.ts` to auto-configure webhook subscriptions.

**Returns:** `string[]`

### Built-in Handlers

| Topic | Behavior |
|-------|----------|
| `APP_UNINSTALLED` | Soft-delete shop (`isDeleted: true`) |
| `APP_SUBSCRIPTIONS_UPDATE` | Activate/deactivate billing plan |
| `CUSTOMERS_DATA_REQUEST` | Log (GDPR compliance acknowledgment) |
| `CUSTOMERS_REDACT` | Log (GDPR compliance acknowledgment) |
| `SHOP_REDACT` | Hard-delete all shop data in transaction |

---

## email — Transactional Email

**File:** `app/services/email.ts`
**Purpose:** Resend-powered email service with i18n support. Dev mode: emails are logged but NOT sent when `RESEND_API_KEY` is not set.

```typescript
import { sendEmail, sendWelcomeEmail, sendBillingEmail } from "~/services/email";
```

### Methods

#### `sendEmail(to, subject, html)`

Send a generic transactional email.

| Param | Type | Description |
|-------|------|-------------|
| `to` | `string` | Recipient email |
| `subject` | `string` | Subject line |
| `html` | `string` | HTML body |

**Returns:** `Promise<{ id: string } | null>` — `null` in dev/mock mode.

```typescript
const result = await sendEmail("merchant@example.com", "Hello", "<p>Hi!</p>");
```

#### `sendWelcomeEmail(shopDomain, merchantEmail, locale?)`

Send a welcome email to a newly installed shop. Supports i18n via `locale` parameter.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `shopDomain` | `string` | — | e.g. `"example.myshopify.com"` |
| `merchantEmail` | `string` | — | Recipient email |
| `locale` | `string` | — | `"en"` \| `"zh"` \| `"ja"` \| `"es"` |

**Returns:** `Promise<void>`

```typescript
await sendWelcomeEmail("example.myshopify.com", "merchant@example.com", "en");
```

#### `sendBillingEmail(shopDomain, merchantEmail, planName, action?, locale?)`

Send a billing notification email (subscription confirmed, plan changed, etc.).

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `shopDomain` | `string` | — | Shop domain |
| `merchantEmail` | `string` | — | Recipient email |
| `planName` | `string` | — | e.g. `"Pro"`, `"Business"` |
| `action` | `string` | `"confirmed"` | `"confirmed"` \| `"upgraded"` \| `"downgraded"` \| `"cancelled"` |
| `locale` | `string` | — | i18n locale |

**Returns:** `Promise<void>`

```typescript
await sendBillingEmail("example.myshopify.com", "merchant@example.com", "Pro", "upgraded");
```

---

## Type Reference

All shared types are defined in `app/services/shopify/types.ts`:

| Type | Description |
|------|-------------|
| `ShopifyProduct` | Product with variants and images |
| `ShopifyCollection` | Collection with product count |
| `ShopifyOrder` | Order with line items |
| `ShopifyShopInfo` | Shop metadata |
| `PaginatedResult<T>` | Generic paginated response |
| `ProductQueryOptions` | Options for `getProducts()` |
| `OrderQueryOptions` | Options for `getOrders()` |

