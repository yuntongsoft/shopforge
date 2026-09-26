-- ============================================================================
-- Baseline migration for ShopForge (PostgreSQL)
-- Generated: 2026-09-26
--
-- This is the versioned baseline that matches the current schema.prisma.
-- New databases should use this migration via `prisma migrate deploy`.
-- Old databases (from the 20260115 init) must use scripts/upgrade-db.ts.
--
-- Table names use @map snake_case conventions.
-- No FK from sessions → shops (Shopify SDK writes sessions before Shop exists).
-- ============================================================================

-- CreateTable: shops
CREATE TABLE "shops" (
    "id" TEXT NOT NULL,
    "shopify_domain" TEXT NOT NULL,
    "shopify_token" TEXT NOT NULL,
    "shopify_scope" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "subscription_id" TEXT,
    "subscription_status" TEXT NOT NULL DEFAULT 'NONE',
    "subscription_checked_at" TIMESTAMP(3),
    "initialized_at" TIMESTAMP(3),
    "installation_id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "pending_subscription_id" TEXT,
    "pending_plan" TEXT,
    "pending_confirmation" TEXT,
    "merchant_email" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL DEFAULT 'en',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shops_pkey" PRIMARY KEY ("id")
);

-- CreateTable: sessions
-- No FK to shops — the Shopify SDK stores sessions BEFORE the Shop record
-- exists (during OAuth). The afterAuth hook creates the Shop record afterward.
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "access_token" TEXT NOT NULL,
    "user_id" BIGINT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "account_owner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN NOT NULL DEFAULT false,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "refresh_token" TEXT,
    "refresh_token_expires" TIMESTAMP(3),
    "credential_version" INTEGER NOT NULL DEFAULT 0,
    "refresh_lease_id" TEXT,
    "refresh_lease_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: orders
-- Demo business model. Amount uses Float for cross-database compatibility.
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL DEFAULT '',
    "customer" TEXT NOT NULL DEFAULT '',
    "customer_id" TEXT,
    "external_order_id" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable: shop_functions
-- Maps business rule types to deployed Shopify Function GIDs.
CREATE TABLE "shop_functions" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "function_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_functions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: operation_leases
-- Short-term leases for business operations; network calls happen outside DB transactions.
CREATE TABLE "operation_leases" (
    "key" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "operation_leases_pkey" PRIMARY KEY ("key")
);

-- CreateTable: webhook_executions
-- Tracks webhook processing state for idempotency and retry.
CREATE TABLE "webhook_executions" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "handler_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease_id" TEXT,
    "lease_until" TIMESTAMP(3),
    "triggered_at" TIMESTAMP(3),
    "trace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: privacy_requests
-- GDPR privacy request tracking (customers/data_request, shop/redact).
CREATE TABLE "privacy_requests" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sealed_payload" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "confirmed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "privacy_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: shops
CREATE UNIQUE INDEX "shops_shopify_domain_key" ON "shops"("shopify_domain");
CREATE INDEX "shops_plan_is_deleted_idx" ON "shops"("plan", "is_deleted");
CREATE INDEX "shops_is_deleted_updated_at_idx" ON "shops"("is_deleted", "updated_at");

-- CreateIndex: sessions
CREATE INDEX "sessions_shop_idx" ON "sessions"("shop");

-- CreateIndex: orders
CREATE INDEX "orders_shop_id_created_at_idx" ON "orders"("shop_id", "created_at");

-- CreateIndex: shop_functions
CREATE UNIQUE INDEX "shop_functions_shop_id_rule_type_key" ON "shop_functions"("shop_id", "rule_type");

-- CreateIndex: webhook_executions
CREATE UNIQUE INDEX "webhook_executions_shop_webhook_id_handler_id_key" ON "webhook_executions"("shop", "webhook_id", "handler_id");
CREATE INDEX "webhook_executions_shop_created_at_idx" ON "webhook_executions"("shop", "created_at");

-- CreateIndex: privacy_requests
CREATE UNIQUE INDEX "privacy_requests_shop_webhook_id_key" ON "privacy_requests"("shop", "webhook_id");
CREATE INDEX "privacy_requests_shop_created_at_idx" ON "privacy_requests"("shop", "created_at");

-- AddForeignKey: orders → shops
ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: shop_functions → shops
ALTER TABLE "shop_functions" ADD CONSTRAINT "shop_functions_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
