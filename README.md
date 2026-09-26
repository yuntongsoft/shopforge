# ShopForge

**Production-ready Shopify App Starter Kit** — ship your app in days, not months.

🌐 **Website:** [https://www.yuntongsoft.com](https://www.yuntongsoft.com) · 📖 **Docs:** [Documentation](https://www.yuntongsoft.com/docs)

Battle-tested boilerplate with OAuth, Billing, Functions, GDPR compliance, and more. The core value: **developers never need to understand Shopify's underlying complexity** — Function, Webhook, GraphQL, metafield are all hidden behind clean abstractions.

---

## Features

- **OAuth + Session** — Full Shopify OAuth flow with AES-256-GCM token encryption, auto token refresh, and Prisma session storage
- **Three-Tier Billing** — Free / Pro / Business plans via Shopify Billing API with working upgrade flow
- **Discount Rule Engine** — Create discounts with pure business parameters, no Function IDs or metafields
- **Webhook Registry** — One-line handler registration: `webhookRegistry.on("TOPIC", handler)`
- **Function Pipeline** — `npm run functions:setup` scaffolds from templates → `shopify app deploy` end-to-end
- **Shopify Admin API** — High-level methods hiding all GraphQL complexity
- **GDPR Compliance** — Customer data request, redact, and shop redact webhook handlers
- **Cold-Start Self-Healing** — Auto-reload when App Bridge isn't ready, ErrorBoundary with 401 recovery, and 15s timeout fallback
- **i18n** — `useTranslation` hook with 4 languages (en/zh/ja/es), email templates included
- **Rate Limiter** — Dual-backend: Redis (production multi-process) + Memory Map (dev single-process)
- **CSRF Protection** — HMAC-SHA256 signed tokens for all form submissions
- **XSS Sanitization** — HTML sanitizer with tag/attribute whitelist for email templates and user input
- **Code Generator** — Define a Prisma model, run `npm run generate`, get a complete CRUD page
- **Transactional Email** — Resend-powered email service with i18n support and dev-mode mock
- **Structured Logging** — pino-based logger with trace ID support
- **Retry with Backoff** — Exponential backoff utility for external service calls
- **Theme Extension** — Liquid App Block template with storefront rendering + admin config page
- **Landing Page** — Next.js 14 marketing site in npm workspace (blog, SEO, OG image, pricing)
- **Demo Isolation** — All demo code in `app/demo/` + `tests/demo/`, one command to remove
- **Docker Ready** — Multi-stage Dockerfile + `docker-compose.yml` (App + PostgreSQL + optional Redis)
- **CI/CD** — GitHub Actions pipeline (typecheck → lint → test → migration validate → build → Docker) with blocking gates
- **Prisma Migrations** — Versioned baseline migration + `upgrade:db` tool for legacy database upgrades
- **Unit Testing** — 400+ Vitest cases in unified `tests/` directory
- **ESLint + Prettier** — Pre-configured TypeScript + React linting

---

## Quick Start

> **New to ShopForge?** Follow the step-by-step guide: [Getting Started](GETTING-STARTED.md) — covers Shopify Partner setup, API credentials, environment config, and first launch.

### Option A: Local Development (recommended)

```bash
# 1. Clone
git clone https://github.com/your-org/shopforge.git my-shopify-app
cd my-shopify-app

# 2. Install dependencies
npm install

# 3. Create Shopify App in Partner Dashboard
#    → Create version with App URL: https://example.com
#    → Add scopes: read_discounts,write_discounts,read_orders,read_products,write_products
#    → Add redirect URL: https://example.com/auth/callback
#    → Release the version
#    → Copy API Key + Secret from App settings

# 4. Configure environment
cp .env.example .env
#    Edit .env: SHOPIFY_API_KEY, SHOPIFY_API_SECRET, DATABASE_URL, ENCRYPTION_KEY
#    Edit shopify.app.toml: client_id = "your_api_key"

# 5. Start
npm run dev
#    Press P to open in browser
```

### Option B: Docker

```bash
# 1. Clone + edit .env (same as above)
# 2. Start everything
docker compose up -d
```

### Database Configuration

ShopForge supports **PostgreSQL**, **MySQL**, and **SQLite** out of the box.

| Database | Best for | Setup |
|----------|----------|-------|
| **SQLite** | Development, prototyping | Zero config — just `file:./dev.db` |
| **PostgreSQL** | Production (recommended) | `postgresql://user:pass@host:5432/db` |
| **MySQL** | Teams familiar with MySQL | `mysql://user:pass@host:3306/db` |

**Switch database anytime:**

```bash
# Delete .env and re-run setup
rm .env          # macOS/Linux
del .env         # Windows
npm run setup    # re-configure database
```

The setup script regenerates `prisma/schema.prisma` from the template (`schema.prisma.template`) and creates a fresh `.env` with the correct `DATABASE_URL` format.

### First Steps

```bash
# Remove demo code (optional — keeps only your business code)
npm run clean:demo

# Set up Shopify Functions (copies templates to extensions/)
npm run functions:setup

# Generate a CRUD page from your Prisma model
npm run generate YourModel
```

---

## Project Structure

```
shopforge/
├── app/
│   ├── components/         # Shared UI components (PageErrorBoundary, Toast)
│   ├── demo/               # ★ Demo code — delete this folder to remove all examples
│   │   ├── services/       #   Demo services (rule-engine, discount-api, function-registry)
│   │   ├── routes/         #   Demo route components (discounts, order, pricing, theme-widget)
│   │   └── README.md       #   What's included + how to remove
│   ├── locales/            # i18n translation files (en/zh/ja/es)
│   ├── routes/             # Remix file-based routes
│   │   ├── app.tsx         # App shell — AppProvider + Polaris + NavMenu
│   │   ├── app._index.tsx  # Dashboard (real data from Shopify API)
│   │   ├── app.discounts.tsx   # Thin wrapper → re-exports from demo
│   │   ├── app.order.tsx       # CRUD page + Shopify order sync
│   │   ├── app.pricing.tsx     # Thin wrapper → re-exports from demo
│   │   ├── app.settings.tsx    # Shop info & settings
│   │   ├── app.theme-widget.tsx# Thin wrapper → re-exports from demo
│   │   ├── auth.$.tsx          # OAuth entry point
│   │   ├── auth.callback.tsx   # OAuth callback
│   │   ├── auth.login.tsx      # Bounce redirect for embedded app auth
│   │   ├── health.tsx          # Health check endpoint
│   │   ├── privacy-policy.tsx  # Public privacy policy
│   │   ├── terms.tsx           # Public terms of service
│   │   └── webhooks.tsx        # Webhook handler (pure forwarder)
│   ├── services/           # Business logic layer (infrastructure only)
│   │   ├── billing.service.ts  # Subscription billing (Free/Pro/Business)
│   │   ├── email.ts            # Transactional email (Resend)
│   │   ├── shopify-admin.ts    # High-level API client (hides GraphQL)
│   │   └── webhook-registry.ts # Webhook handler registry + built-in handlers
│   ├── utils/              # Shared utilities
│   │   ├── api-response.ts     # Unified API response format (apiError/apiSuccess/safeError)
│   │   ├── app-bridge.client.ts # SSR-safe access to window.shopify (App Bridge)
│   │   ├── csrf.ts             # CSRF token generation + validation (HMAC-SHA256)
│   │   ├── encryption.ts       # AES-256-GCM token encryption
│   │   ├── env-validator.ts    # Startup env validation (fail fast)
│   │   ├── i18n.ts             # Translation hook + locale management
│   │   ├── logger.ts           # pino-based structured logger
│   │   ├── rate-limiter.ts     # Dual-backend rate limiting (Redis + Memory)
│   │   ├── retry.ts            # Exponential backoff wrapper
│   │   ├── sanitize.ts         # HTML sanitization + XSS prevention
│   │   ├── shopify-auth.server.ts # Auth flow: token verify, exchange, bounceRedirect, needsRefresh
│   │   ├── shopify-config.ts   # Shared API version constant
│   │   └── shop-registration.ts# Shared OAuth shop registration logic
│   ├── db.server.ts        # Prisma client singleton
│   ├── entry.server.tsx    # Remix server entry (TraceID + security headers)
│   ├── root.tsx            # HTML shell (loading overlay + ErrorBoundary)
│   └── shopify.server.ts   # Shopify SDK init (OAuth, webhooks, sessions)
├── tests/                  # ★ All tests live here (unified directory)
│   ├── setup.ts            # Global test setup (mocks)
│   ├── utils/              # Infrastructure utility tests
│   ├── services/           # Infrastructure service tests
│   └── demo/               # Demo-specific tests
├── extensions/             # Shopify Functions (generated by npm run functions:setup)
├── landing/                # Marketing site (npm workspace member)
│   ├── app/blog/           # Blog listing + post detail
│   ├── components/         # Hero, Features, Testimonials, FAQ, CTA, etc.
│   ├── content/blog/       # Markdown blog posts
│   └── lib/blog.ts         # Markdown parser
├── prisma/
│   ├── schema.prisma       # Database schema (Shop, Session, Order, ShopFunction, OperationLease, WebhookExecution, PrivacyRequest)
│   └── migrations/         # Versioned Prisma migrations (baseline + upgrade tool)
├── scripts/
│   ├── _internal/          # Internal tools (developers don't touch these)
│   │   ├── generate-function.ts  # Function scaffolding
│   │   ├── setup-discount.ts     # Discount deployment helper
│   │   └── test-function.ts      # Local Function test runner
│   ├── lib/                # Shared script modules
│   │   ├── compile-functions.ts  # Rust Function compilation (dev + build)
│   │   ├── schema-parser.ts      # Prisma schema parser
│   │   └── upgrade-db.ts         # Database upgrade planning (pure logic)
│   ├── build.ts            # Production build (compile Functions + Remix)
│   ├── check.ts            # Cross-platform type check + test runner
│   ├── clean-demo.ts       # Remove all demo code automatically
│   ├── dev.ts              # Smart dev server (auto env, db, Functions)
│   ├── generate.ts         # CRUD page code generator
│   ├── seed.ts             # Database seed with demo data
│   ├── setup-functions.ts  # Copy Function templates to extensions/
│   └── upgrade-db.ts       # Database upgrade CLI (legacy → current baseline)
├── templates/              # Function templates (Rust)
│   ├── hello-function-rust/    # Minimal Function (verify WASM build)
│   └── order-discount-rust/    # Order discount with metafield config
├── .github/workflows/ci.yml  # GitHub Actions CI pipeline
├── Dockerfile              # Multi-stage production build
├── docker-compose.yml      # App + PostgreSQL + optional Redis
├── server.mjs              # Production Express server
├── shopify.app.toml        # Shopify app configuration
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

---

## Module Guide

### Authentication (`utils/shopify-auth.server.ts`)
- `authenticatePage(request)` — Full auth flow: extract id_token → verify → DB lookup → token exchange → register shop. Returns `AuthPageResult` (3-variant union: `ok` / `response` / `needsRefresh`)
- `authResponse(auth)` — Type-safe helper to extract `Response` from `AuthPageResult` (handles `needsRefresh` variant via `bounceRedirect`)
- `verifySessionToken(token)` — Verifies JWT from App Bridge
- `isValidShopDomain(shop)` — SSRF prevention for shop domains
- **Cold-start handling**: When no `id_token` is available (App Bridge hasn't initialized), returns `needsRefresh` for graceful degradation. Homepage auto-reloads once App Bridge provides the token.

### Shopify Admin API (`services/shopify/`)

High-level client that hides GraphQL complexity:

```typescript
// Before: 30+ lines of GraphQL boilerplate
const response = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, { ... });
const data = await response.json();
const products = data.data.products.edges.map(e => e.node);

// After: 1 line
const { items: products } = await shopifyAdmin(shop).getProducts({ first: 20 });
```

Available methods:
- `getProducts()` / `getAllProducts()` — with auto cursor pagination
- `getCollections()` / `getCollectionProducts()` — list collections
- `getOrders()` / `getRecentOrders()` / `getOrderStats()` — order queries
- `getShopInfo()` — shop name, plan, currency
- `getCustomers()` — list/search customers
- `getMetafields()` / `setMetafield()` / `getShopMetafield()` / `setShopMetafield()` — metafield CRUD
- `graphql()` — raw escape hatch for custom queries

> **Full method signatures, parameter tables, and usage examples:** see [Services API Reference](docs/services-api.md)

### Discount Rule Engine (`app/demo/services/rule-engine.ts`)

> **Note:** This is demo code. Delete `app/demo/` and `tests/demo/` to remove it.

Create discounts with pure business parameters — no Function IDs, no metafields:

```typescript
const engine = ruleEngine(shopDomain, accessToken);
await engine.createDiscount({
  type: "order-discount",
  title: "10% off $50+",
  rule: { minSubtotal: "50.0", discountPercent: 10 },
});
```

Supported types: `order-discount`, `free-shipping`, `volume-discount`, `bogo`.

### Webhook Registry (`services/webhook-registry.ts`)

Register handlers in one line — webhooks are auto-configured from the registry:

```typescript
webhookRegistry.on("ORDERS_CREATE", async (shop, payload) => {
  // Handle new order
});
```

Built-in handlers: `APP_UNINSTALLED`, `APP_SUBSCRIPTIONS_UPDATE`, GDPR compliance topics.
Methods: `on()` / `dispatch()` / `getRegisteredTopics()`. Includes retry with exponential backoff.
See [Services API Reference](docs/services-api.md) for full details.

### Billing (`services/billing.service.ts`)
- Three plans: Free / Pro / Business
- Usage tracking via `app_subscriptions/update` webhook
- `billingService.getShopPlan()` / `createSubscription()` / `handleSubscriptionActivated()` / `handleSubscriptionDeactivated()`
- See [Services API Reference](docs/services-api.md) for full signatures

### Email (`services/email.ts`)
- `sendEmail(to, subject, html)` — generic transactional email
- `sendWelcomeEmail(shop, email, locale?)` — Welcome email with i18n (en/zh/ja/es)
- `sendBillingEmail(shop, email, plan, action, locale?)` — Subscription notifications with i18n
- All user-provided data is escaped with `escapeHtml()` to prevent XSS
- Dev mode: emails are logged but NOT sent (safe for local dev)

### i18n (`utils/i18n.ts`)
- `useTranslation()` hook — returns `{ t, locale }`
- Priority: URL param > localStorage > browser language > "en"
- Server-side: `getTranslation(locale)` for loaders

### Rate Limiter (`utils/rate-limiter.ts`)
- `rateLimit(key, { max, windowMs })` — returns null or `{ retryAfter }`
- Presets: `login` (5/min), `write` (10/min), `api` (60/min)

### Demo Code (`app/demo/`)

All example code lives in a dedicated directory so it's easy to remove:

```
app/demo/
├── services/       # rule-engine, discount-api, function-registry
└── routes/         # discounts, order, pricing, theme-widget
```

Route files in `app/routes/` are thin wrappers that re-export from demo:

```tsx
// app/routes/app.discounts.tsx — just a re-export
export { loader, action, default } from "~/demo/routes/discounts";
```

**Remove everything:** `npm run clean:demo` (or just `rm -rf app/demo tests/demo` + wrapper files).

### Testing

All tests live in the unified `tests/` directory:

```
tests/
├── setup.ts        # Global mocks (Prisma, env vars)
├── utils/          # Infrastructure tests (csrf, encryption, auth, ...)
├── services/       # Service tests (billing, admin, webhook)
└── demo/           # Demo-specific tests (rule-engine, function-registry)
```

```bash
npm test           # Watch mode
npm run check          # Type check + full test run
```

---

## How to Extend

### Add a Business Page (Code Generator)

```bash
# 1. Add your model to prisma/schema.prisma (must include shopId)
# 2. Sync database
npm run db:push
# 3. Generate CRUD page
npm run generate YourModel
# 4. Add navigation link in app/routes/app.tsx
```

### Add a Shopify Function

```bash
# Copy templates to extensions/ and configure
npm run functions:setup

# Edit extensions/<name>/src/lib.rs — customize logic

# Deploy
npx shopify app deploy
```

### Manual

1. **New page**: Create `app/routes/app.your-feature.tsx`
2. **New model**: Add to `prisma/schema.prisma`, run `npm run db:push`
3. **New migration**: `npm run db:migrate:create --name your_migration_name`
4. **New language**: Create `app/locales/{locale}.json`, import in `utils/i18n.ts`
5. **Reference**: See `app/demo/routes/order.tsx` for the full CRUD pattern

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Smart dev server (auto env, db sync, Function compile) |
| `npm run build` | Production build (Functions + Remix) |
| `npm start` | Start production server |
| `npm run check` | Cross-platform type check + test |
| `npm run generate` | Generate CRUD page from Prisma model |
| `npm run db:push` | Sync Prisma schema to database |
| `npm run db:migrate` | Run pending migrations (production) |
| `npm run db:migrate:dev` | Run migrations in dev (resets if drift) |
| `npm run db:migrate:create` | Create a new migration file |
| `npm run db:seed` | Seed database with demo data |
| `npm run functions:setup` | Copy Function templates to `extensions/` |
| `npm run clean:demo` | Remove all demo code (services, routes, tests) |
| `npm run upgrade:db` | Upgrade legacy database to current baseline (dry-run by default) |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |
| `npm test` | Run Vitest (watch mode) |
| `npm run typecheck` | TypeScript type check only |
| `npm run landing:dev` | Start landing page dev server |
| `npm run landing:build` | Build landing page for production |
| `npm run landing:start` | Start landing page production server |

---

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for detailed guides covering Vercel, Railway, Fly.io, and Docker.

### Before You Deploy

`shopify.app.toml` 中的 URL 默认是开发占位符，**发布前必须替换为你的真实生产域名**：

```toml
# shopify.app.toml

# ❌ 开发占位符（默认值）
application_url = "https://example.com"

# ✅ 替换为你的生产域名
application_url = "https://your-app.your-domain.com"

[auth]
  # ❌ 开发占位符
  redirect_urls = ["https://example.com/auth/callback"]

  # ✅ 替换为你的生产域名
  redirect_urls = ["https://your-app.your-domain.com/auth/callback"]
```

| 字段 | 开发环境 | 生产环境 |
|------|----------|----------|
| `application_url` | `https://example.com`（CLI 自动替换为隧道 URL） | 你的真实域名 |
| `redirect_urls` | `https://example.com/auth/callback`（CLI 自动同步） | `https://你的域名/auth/callback` |
| `client_id` | 空（`shopify app dev --reset` 时 CLI 自动写入） | Partner Dashboard 中的 App Client ID |

**发布流程：**

```bash
# 1. 编辑 shopify.app.toml — 替换为真实域名
# 2. 部署到服务器（Docker / Vercel / Railway）
# 3. 同步 Shopify 配置
npx shopify app deploy
# 4. 在 Shopify Admin → Apps 中重新安装
```

> **Note:** 开发时不需要手动改 URL — `shopify app dev` 会通过 Cloudflare 隧道自动管理。

### Quick Deploy

```bash
# Docker (recommended for full control)
docker compose up -d

# Vercel
vercel --prod

# CI/CD is pre-configured: push to main triggers GitHub Actions
# Pipeline: typecheck → test → build → Docker image
```

---

## Tech Stack

- **Framework**: Remix 2.x + Vite 5
- **UI**: Polaris 12 + App Bridge 4
- **Database**: PostgreSQL + Prisma 5
- **Server**: Express 4 (production)
- **Functions**: Rust + Shopify Function SDK (WASM)
- **Landing**: Next.js 14 + Tailwind CSS (npm workspace)
- **Language**: TypeScript 5 (strict mode)
- **Package Manager**: npm (workspace mode)

---

## License

MIT — use it however you want. Build apps, sell them, modify them. No attribution required.

## Documentation

- 🚀 **[Getting Started](GETTING-STARTED.md)** — Step-by-step guide from clone to running app
- 🌐 **Official Website:** [https://www.yuntongsoft.com](https://www.yuntongsoft.com)
- 📖 **Documentation & Guides:** [https://www.yuntongsoft.com/docs](https://www.yuntongsoft.com/docs)
- [CHANGELOG.md](CHANGELOG.md) — Release history and notable changes
- [CONTRIBUTING.md](CONTRIBUTING.md) — How to contribute, coding standards, PR process
- [DEPLOYMENT.md](DEPLOYMENT.md) — Deployment guides for Vercel, Railway, Fly.io, Docker
- [Services API Reference](docs/services-api.md) — Method-level documentation for all service modules
