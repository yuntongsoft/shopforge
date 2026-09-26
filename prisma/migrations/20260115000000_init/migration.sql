-- CreateTable: Shop
-- Stores OAuth tokens and billing state for each installed merchant.
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "shopify_domain" VARCHAR(255) NOT NULL,
    "shopify_token" TEXT NOT NULL,
    "shopify_scope" TEXT NOT NULL DEFAULT '',
    "plan" TEXT NOT NULL DEFAULT 'free',
    "merchant_email" TEXT NOT NULL DEFAULT '',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Session
-- Server-side session store for Shopify OAuth flow.
-- Tokens are AES-256-GCM encrypted at rest.
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "is_online" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "access_token" TEXT NOT NULL,
    "expires" TIMESTAMP(3),
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
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Order
-- Demo model — developers typically replace this with their own business models.
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL DEFAULT '',
    "customer" TEXT NOT NULL DEFAULT '',
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ShopFunction
-- Maps business rule types to deployed Shopify Function GIDs.
-- Managed by function-registry.ts — developers never touch this directly.
CREATE TABLE "ShopFunction" (
    "id" TEXT NOT NULL,
    "shop_id" TEXT NOT NULL,
    "rule_type" TEXT NOT NULL,
    "function_id" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopFunction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Shop_shopify_domain_key" ON "Shop"("shopify_domain");
CREATE INDEX "shops_plan_is_deleted_idx" ON "Shop"("plan", "is_deleted");
CREATE INDEX "shops_is_deleted_updated_at_idx" ON "Shop"("is_deleted", "updated_at");
CREATE INDEX "Session_shop_idx" ON "Session"("shop");
CREATE INDEX "Order_shop_id_created_at_idx" ON "Order"("shop_id", "created_at");
CREATE INDEX "ShopFunction_shop_id_idx" ON "ShopFunction"("shop_id");
CREATE UNIQUE INDEX "ShopFunction_shop_id_rule_type_key" ON "ShopFunction"("shop_id", "rule_type");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_shop_fkey" FOREIGN KEY ("shop") REFERENCES "Shop"("shopify_domain") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShopFunction" ADD CONSTRAINT "ShopFunction_shop_id_fkey" FOREIGN KEY ("shop_id") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
