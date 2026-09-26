# Changelog

All notable changes to ShopForge are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Baseline Migration**: Versioned `20260926000000_baseline` covering all 7 tables (shops, sessions, orders, shop_functions, operation_leases, webhook_executions, privacy_requests) with correct snake_case naming, indexes, and FK constraints
- **Database Upgrade Tool**: `scripts/upgrade-db.ts` — detects legacy PascalCase databases and plans safe migration to current baseline (dry-run by default, idempotent, no data loss)
- **CI Migration Validation**: GitHub Actions now validates Prisma schema and migration file integrity as a blocking gate
- **Unified API Response Format**: `api-response.ts` with `apiError()` / `apiSuccess()` / `safeError()` helpers — all action routes now return consistent `{ error, code }` or `{ success, data, message }` structures
- **PageErrorBoundary**: Reusable error boundary component for all app page routes with i18n support and security hardening (internal errors sanitized to prevent stack/SQL leak)
- **Shopify Order Sync**: Order page now includes "Sync from Shopify" button that fetches orders via Admin API and upserts to local DB
- **Complete Shopify Status i18n**: All Shopify financial/fulfillment status values mapped in 4 languages (authorized, voided, partially_paid, in_progress, etc.)
- **Empty State Images**: Order and discount lists show empty-state.png when no data

### Changed
- **Rust Function Templates**: Upgraded from shopify_function SDK 0.8 to 2.2.0 with `#[typegen]` macro, `schema.graphql`, `wasm32-unknown-unknown` target, and new output type conventions
- **Clean Demo Refactor**: Rewritten as declarative change manifest with pure transform functions, CRLF normalization, and dry-run/apply modes
- **CI Gates**: Typecheck, lint, and tests are now blocking (removed `continue-on-error: true`); Summary job correctly fails on any upstream failure
- **ErrorBoundary Coverage**: All app page routes now export `PageErrorBoundary` (dashboard, pricing, order, discounts, settings, theme-widget, billing)
- **Order Status Display**: Split into dual badges (financial + fulfillment) with proper tone colors, handles Shopify uppercase values
- **Seed Script**: Fixed non-existent `Item` model reference, corrected order status values

### Fixed
- **Post-Deploy Checklist**: Changed `prisma db push` to `prisma migrate deploy` for production deployments
- **Setup Functions**: Updated Rust target from `wasm32-wasi` to `wasm32-unknown-unknown`, removed `cargo-wasi` references

### Security
- `PageErrorBoundary` now distinguishes user-facing errors (Response) from internal errors (TypeError/SQL), only exposing safe messages to clients

---

## [1.0.0] — 2026-09-16

### Added
- **Auto Token Refresh**: `authenticatePage()` now automatically refreshes expiring offline tokens via Token Exchange (Shopify 2026-07+ requirement)
- **CSRF Protection**: HMAC-SHA256 signed tokens for form submissions (`utils/csrf.ts`)
- **XSS Sanitization**: HTML sanitization utility for email templates and user input (`utils/sanitize.ts`)
- **Email i18n**: Welcome and billing emails support 4 languages (en/zh/ja/es) via `getTranslation()`
- **Dual-Backend Rate Limiter**: Redis (production multi-process) + Memory Map (dev single process) with automatic fallback
- **Comprehensive Test Suite**: 100+ test cases covering encryption, auth, rate-limiter, billing, webhook-registry, CSRF, sanitize, i18n, env-validator, shop-registration, rule-engine
- **Code Generation Safety**: Generated CRUD routes now include `auth.ok` check to prevent unauthenticated access
- **Health Endpoint Auth**: Detail mode requires `CRON_SECRET` to prevent information leakage

### Changed
- **Unified Auth**: All routes now use `authenticatePage()` instead of `authenticate.admin()` for consistent behavior
- **Shared Registration**: `afterAuth` hook, `auth.$.tsx`, and `auth.callback.tsx` all use shared `registerShop()` — zero duplication
- **Order Page**: Replaced placeholder "Option A/B/C" with real order statuses (Pending, Processing, Shipped, Delivered, Cancelled, Refunded)
- **Landing Page**: Replaced fictional testimonials with clearly marked examples; fixed empty `href="#"` links
- **Schema**: Added indexes on `shop.plan`, `shop.isDeleted`, `session.shop`, `order.shopId`; added `merchantEmail` field; added `updatedAt` to all models

### Fixed
- Privacy Policy and Terms pages: Removed duplicate `<html>` tags, replaced all `[Your App Name]` placeholders
- `shopify.app.toml`: Updated `redirect_urls` and `application_url` to `shopforge.dev`
- Locale files: Replaced "Your App Name" with "ShopForge" in all 4 languages
- Code generator template: Now generates `auth.ok` check pattern

### Security
- Added CSRF token generation and validation (`utils/csrf.ts`)
- Email templates now escape all user-provided data with `escapeHtml()`
- Health endpoint detail mode requires `X-Cron-Secret` header or `secret` query param
- Scopes in `shopify.app.toml` audited and aligned with actual API usage

---

## [0.9.0] — 2026-08-01

### Added
- Three-tier discount abstraction (Rule Engine → Discount API → Function)
- Billing service with Shopify GraphQL Admin API
- Webhook registry with auto-subscription from registered handlers
- GDPR compliance webhooks (CUSTOMERS_DATA_REQUEST, CUSTOMERS_REDACT, SHOP_REDACT)
- Landing page with Hero, Features, Pricing, Testimonials, FAQ, CTA sections
- Blog system with Markdown content support
- Code generator for CRUD routes from Prisma Schema

### Changed
- Migrated from `authenticate.admin()` to custom `authenticatePage()` for embedded app support
- Rate limiter upgraded from memory-only to dual-backend (Redis + Memory)

---

## [0.1.0] — 2026-06-15

### Added
- Initial project scaffold with Remix 2.15 + Polaris 12 + Prisma 5
- Shopify OAuth flow with AES-256-GCM token encryption
- Basic CRUD example page (Order model)
- i18n support with 4 languages
- Environment variable validation at startup
- Structured logging with `createLogger()`
