# Changelog

All notable changes to ShopForge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Webhook Resilience Engine**: Production-grade async webhook processing infrastructure
  - **Async Job Queue** (`webhook-queue.ts`): CAS-based atomic claim, heartbeat renewal, lease recovery, dead-letter after 3 attempts, exponential backoff (30s base), concurrency guard
  - **Outbound Webhook Delivery** (`webhook-outbound.ts`): SSRF protection (private IP blocking, DNS pinning, port whitelist), HMAC-SHA256 signing, 5s timeout with retry
  - **Webhook Management API** (`api.webhooks.tsx`): CRUD for merchant webhook configs, secret returned only at creation
  - **Cron Endpoint** (`api.cron.tsx`): Crash recovery, lease reclaim, dead-letter inspection, queue stats
  - **WebhookJob Prisma Model**: Status lifecycle tracking (pending → processing → completed/failed), attempts counter, lease management
  - **29 Tests**: Comprehensive coverage across queue (9), outbound (10), and registry (10)
- **Baseline Migration**: Versioned `20260926000000_baseline` covering all 7 tables (shops, sessions, orders, shop_functions, operation_leases, webhook_executions, privacy_requests) with correct snake_case naming, indexes, and FK constraints
- **Database Upgrade Tool**: `scripts/upgrade-db.ts` — detects legacy PascalCase databases and plans safe migration to current baseline (dry-run by default, idempotent, no data loss)
- **CI Migration Validation**: GitHub Actions now validates Prisma schema and migration file integrity as a blocking gate
- **Unified API Response Format**: `api-response.ts` with `apiError()` / `apiSuccess()` / `safeError()` helpers — all action routes now return consistent `{ error, code }` or `{ success, data, message }` structures
- **PageErrorBoundary**: Reusable error boundary component for all app page routes with i18n support and security hardening (internal errors sanitized to prevent stack/SQL leak)
- **Shopify Order Sync**: Order page now includes "Sync from Shopify" button that fetches orders via Admin API and upserts to local DB
- **Complete Shopify Status i18n**: All Shopify financial/fulfillment status values mapped in 4 languages (authorized, voided, partially_paid, in_progress, etc.)
- **Empty State Images**: Order and discount lists show empty-state.png when no data
- **Shopify API Rate Limiter**: Production-grade rate limiting for Shopify Admin API calls (`services/shopify-rate-limiter.ts`)
  - **Adaptive Delay**: Dynamically adjusts request interval based on response headers and error rates
  - **Circuit Breaker**: Three-state (closed/open/half-open) protection against cascading failures
  - **Triple Backend**: Redis (production multi-process) → Memory Map (dev single process) → DB (fallback persistence)
  - **Environment Variable Overrides**: All timing parameters configurable via `RATE_LIMITER_*` env vars
  - **Monitoring Metrics**: Integrated into health endpoint for real-time rate limiter status visibility
- **Architecture Documentation**: Seven deep-dive docs covering all core subsystems
  - `docs/services-api.md` — Method-level API reference for all service modules
  - `docs/shopify-rate-limiter.md` — Adaptive delay, circuit breaker, triple-backend architecture
  - `docs/authentication.md` — Dual auth system, session tokens, token exchange, bounce redirect flow
  - `docs/webhook-system.md` — Handler registry, async job queue, outbound delivery, SSRF protection
  - `docs/privacy-gdpr.md` — Privacy webhooks, encrypted payloads, provider registry, data retention
  - `docs/data-model.md` — Prisma schema, ERD, relationships, index strategy, design decisions
  - `docs/environment-variables.md` — Required/optional variables, rate limiter overrides, generation commands

### Changed
- **WebhookRegistry Upgrade**: Support both sync and async handlers; async handlers enqueued for background processing via job queue; N² execution fix (dispatch enqueues once per topic, dispatchHandlers runs all async handlers); APP_UNINSTALLED marked async to avoid Shopify 5s webhook timeout
- **Rust Function Templates**: Upgraded from shopify_function SDK 0.8 to 2.2.0 with `#[typegen]` macro, `schema.graphql`, `wasm32-unknown-unknown` target, and new output type conventions
- **Clean Demo Refactor**: Rewritten as declarative change manifest with pure transform functions, CRLF normalization, and dry-run/apply modes
- **CI Gates**: Typecheck, lint, and tests are now blocking (removed `continue-on-error: true`); Summary job correctly fails on any upstream failure
- **ErrorBoundary Coverage**: All app page routes now export `PageErrorBoundary` (dashboard, pricing, order, discounts, settings, theme-widget, billing)
- **Order Status Display**: Split into dual badges (financial + fulfillment) with proper tone colors, handles Shopify uppercase values
- **Seed Script**: Fixed non-existent `Item` model reference, corrected order status values
- **Documentation Restructure**: README.md now features a structured Architecture Docs table with links to all deep-dive docs, cross-reference links in module guides (Authentication, Webhooks, Rate Limiter), and updated project structure tree including `docs/` directory
- **Deployment Guide**: Added cross-reference to environment-variables.md for complete env var documentation

### Fixed
- **Post-Deploy Checklist**: Changed `prisma db push` to `prisma migrate deploy` for production deployments
- **Setup Functions**: Updated Rust target from `wasm32-wasi` to `wasm32-unknown-unknown`, removed `cargo-wasi` references

### Security
- **Outbound Webhook SSRF Protection**: Private IP blocking (IPv4/IPv6), DNS pinning to prevent rebinding attacks, port whitelist (80/443/8080/8443/3000/5000), protocol whitelist (http/https only)
- **IPv6-Mapped IPv4 SSRF Bypass Fix**: `isPrivateIp()` now detects `::ffff:192.168.1.1` style addresses and validates the embedded IPv4 portion
- **HMAC-SHA256 Webhook Signing**: Outbound webhooks signed with per-config secrets for payload verification by recipients
- `PageErrorBoundary` now distinguishes user-facing errors (Response) from internal errors (TypeError/SQL), only exposing safe messages to clients

---

## [1.0.0] — 2026-09-17

### Added
- **OAuth + Session**: Full Shopify OAuth flow with AES-256-GCM token encryption, auto token refresh via Token Exchange, and Prisma session storage
- **Three-Tier Billing**: Free / Pro / Business plans via Shopify Billing API with working upgrade flow
- **Discount Rule Engine**: Three-tier abstraction (Rule Engine → Discount API → Function) — create discounts with pure business parameters
- **Webhook Registry**: Handler registry with auto-subscription from registered handlers, built-in GDPR compliance (CUSTOMERS_DATA_REQUEST, CUSTOMERS_REDACT, SHOP_REDACT)
- **Dual-Backend Rate Limiter**: Redis (production multi-process) + Memory Map (dev single process) with automatic fallback
- **CSRF Protection**: HMAC-SHA256 signed tokens for form submissions (`utils/csrf.ts`)
- **XSS Sanitization**: HTML sanitization utility for email templates and user input (`utils/sanitize.ts`)
- **Email i18n**: Welcome and billing emails support 4 languages (en/zh/ja/es) via `getTranslation()`
- **Comprehensive Test Suite**: 100+ test cases covering encryption, auth, rate-limiter, billing, webhook-registry, CSRF, sanitize, i18n, env-validator, shop-registration, rule-engine
- **Code Generator**: Define a Prisma model, run `npm run generate`, get a complete CRUD page
- **Health Endpoint Auth**: Detail mode requires `CRON_SECRET` to prevent information leakage
- **Landing Page**: Marketing site with Hero, Features, Pricing, FAQ, CTA sections + Blog system with Markdown content
- **Theme Extension**: Liquid App Block template with storefront rendering + admin config page
- **Docker Ready**: Multi-stage Dockerfile + `docker-compose.yml` (App + PostgreSQL + optional Redis)
- **CI/CD**: GitHub Actions pipeline (typecheck → lint → test → build → Docker)

### Changed
- **Unified Auth**: All routes use `authenticatePage()` instead of `authenticate.admin()` for consistent embedded app support
- **Shared Registration**: `afterAuth` hook, `auth.$.tsx`, and `auth.callback.tsx` all use shared `registerShop()` — zero duplication
- **i18n**: `useTranslation` hook with 4 languages (en/zh/ja/es), priority: URL param > localStorage > browser

### Security
- AES-256-GCM token encryption for Shopify OAuth tokens
- CSRF token generation and validation (`utils/csrf.ts`)
- Email templates escape all user-provided data with `escapeHtml()`
- Health endpoint detail mode requires `X-Cron-Secret` header or `secret` query param
- Scopes in `shopify.app.toml` aligned with actual API usage
