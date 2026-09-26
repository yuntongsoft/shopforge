/**
 * File: scripts/lib/upgrade-db.ts
 * Purpose: Pure functions and constants for database upgrade planning.
 *
 * These functions have no side effects and no database dependency.
 * They compute the upgrade plan from a detected database state.
 */

/* ── Types ──────────────────────────────────────────────────────────────── */

/** Detected database state. */
export type DbState =
  | { kind: "fresh" }
  | { kind: "current" }
  | { kind: "legacy"; legacyTables: string[] }
  | { kind: "mixed"; legacyTables: string[]; currentTables: string[] }
  | { kind: "failed_migration"; details: string }
  | { kind: "unknown_provider"; provider: string };

export interface UpgradeStep {
  sql: string;
  description: string;
}

export interface UpgradePlan {
  state: DbState;
  steps: UpgradeStep[];
  warnings: string[];
}

/* ── Constants ──────────────────────────────────────────────────────────── */

/** Legacy PascalCase table names from the 20260115 init migration. */
export const LEGACY_TABLES = ["Shop", "Session", "Order", "ShopFunction"] as const;

/** Current snake_case table names from the baseline migration. */
export const CURRENT_TABLES = [
  "shops",
  "sessions",
  "orders",
  "shop_functions",
  "operation_leases",
  "webhook_executions",
  "privacy_requests",
] as const;

/** Mapping: legacy table → new table name. */
export const TABLE_RENAME_MAP: Record<string, string> = {
  Shop: "shops",
  Session: "sessions",
  Order: "orders",
  ShopFunction: "shop_functions",
};

interface ColumnDef {
  name: string;
  type: string;
  nullable?: boolean;
  default?: string;
}

/** Columns to add to shops (with their PostgreSQL type and default). */
export const SHOPS_NEW_COLUMNS: ColumnDef[] = [
  { name: "subscription_id", type: "TEXT", nullable: true },
  { name: "subscription_status", type: "TEXT", nullable: false, default: "'NONE'" },
  { name: "subscription_checked_at", type: "TIMESTAMP(3)", nullable: true },
  { name: "initialized_at", type: "TIMESTAMP(3)", nullable: true },
  { name: "installation_id", type: "TEXT", nullable: false, default: "gen_random_uuid()::text" },
  { name: "pending_subscription_id", type: "TEXT", nullable: true },
  { name: "pending_plan", type: "TEXT", nullable: true },
  { name: "pending_confirmation", type: "TEXT", nullable: true },
  { name: "locale", type: "TEXT", nullable: false, default: "'en'" },
];

/** Columns to add to sessions. */
export const SESSIONS_NEW_COLUMNS: ColumnDef[] = [
  { name: "credential_version", type: "INTEGER", nullable: false, default: "0" },
  { name: "refresh_lease_id", type: "TEXT", nullable: true },
  { name: "refresh_lease_until", type: "TIMESTAMP(3)", nullable: true },
];

/** Columns to add to orders. */
export const ORDERS_NEW_COLUMNS: ColumnDef[] = [
  { name: "customer_id", type: "TEXT", nullable: true },
  { name: "external_order_id", type: "TEXT", nullable: true },
];

/* ── Detection helper ───────────────────────────────────────────────────── */

/**
 * Classify table names into a database state.
 * Pure function — no database access.
 */
export function classifyState(tableNames: string[]): DbState {
  const hasLegacy = LEGACY_TABLES.some((t) => tableNames.includes(t));
  const legacyTables = LEGACY_TABLES.filter((t) => tableNames.includes(t));
  const currentTables = CURRENT_TABLES.filter((t) => tableNames.includes(t));
  const hasCurrent = currentTables.length > 0;

  // Fresh database — no tables at all
  if (tableNames.length === 0) {
    return { kind: "fresh" };
  }

  // Mixed state — both legacy and current tables exist (conflict!)
  if (hasLegacy && hasCurrent) {
    return { kind: "mixed", legacyTables, currentTables };
  }

  // Legacy database — old PascalCase tables
  if (hasLegacy && !hasCurrent) {
    return { kind: "legacy", legacyTables };
  }

  // Current database — all current tables present
  if (CURRENT_TABLES.every((t) => tableNames.includes(t))) {
    return { kind: "current" };
  }

  // Partial current tables — possibly failed migration
  if (hasCurrent && currentTables.length < CURRENT_TABLES.length) {
    const missing = CURRENT_TABLES.filter((t) => !tableNames.includes(t));
    return {
      kind: "failed_migration",
      details: `Missing tables: ${missing.join(", ")}`,
    };
  }

  return { kind: "fresh" };
}

/* ── Plan computation ───────────────────────────────────────────────────── */

/**
 * Compute the upgrade plan based on detected state.
 * Returns an ordered list of SQL steps.
 */
export function computePlan(state: DbState): UpgradePlan {
  const steps: UpgradeStep[] = [];
  const warnings: string[] = [];

  switch (state.kind) {
    case "fresh":
      return { state, steps, warnings };

    case "current":
      return { state, steps, warnings };

    case "mixed":
      warnings.push(
        "CONFLICT: Both legacy (PascalCase) and current (snake_case) tables exist.",
        `Legacy: ${state.legacyTables.join(", ")}`,
        `Current: ${state.currentTables.join(", ")}`,
        "Cannot auto-merge. Manual intervention required.",
      );
      return { state, steps, warnings };

    case "failed_migration":
      warnings.push(
        `FAILED MIGRATION detected: ${state.details}`,
        "Cannot auto-recover. Manual intervention required.",
      );
      return { state, steps, warnings };

    case "unknown_provider":
      warnings.push(
        `Unsupported provider: ${state.provider}`,
        "This upgrade tool only supports PostgreSQL.",
        "For MySQL/SQLite, create a new database with prisma migrate deploy.",
      );
      return { state, steps, warnings };

    case "legacy":
      return computeLegacyUpgrade(state);
  }
}

/**
 * Compute upgrade steps for a legacy (PascalCase) database.
 */
function computeLegacyUpgrade(state: { kind: "legacy"; legacyTables: string[] }): UpgradePlan {
  const steps: UpgradeStep[] = [];
  const warnings: string[] = [];

  // Step 0: Drop Session FK
  steps.push({
    sql: `DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Session_shop_fkey'
  ) THEN
    ALTER TABLE "Session" DROP CONSTRAINT "Session_shop_fkey";
  END IF;
END $$;`,
    description: "Drop Session→Shop FK (SDK writes sessions before Shop exists)",
  });

  // Step 1: Rename tables
  for (const [legacy, current] of Object.entries(TABLE_RENAME_MAP)) {
    if (state.legacyTables.includes(legacy)) {
      steps.push({
        sql: `ALTER TABLE "${legacy}" RENAME TO "${current}";`,
        description: `Rename "${legacy}" → "${current}"`,
      });
    }
  }

  // Step 2: Rename indexes
  steps.push({
    sql: `DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Shop_shopify_domain_key') THEN
    ALTER INDEX "Shop_shopify_domain_key" RENAME TO "shops_shopify_domain_key";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ShopFunction_shop_id_idx') THEN
    DROP INDEX "ShopFunction_shop_id_idx";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'ShopFunction_shop_id_rule_type_key') THEN
    ALTER INDEX "ShopFunction_shop_id_rule_type_key" RENAME TO "shop_functions_shop_id_rule_type_key";
  END IF;
END $$;`,
    description: "Rename legacy indexes to match baseline naming",
  });

  // Step 3: Rename FK constraints
  steps.push({
    sql: `DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'Order_shop_id_fkey') THEN
    ALTER TABLE "orders" DROP CONSTRAINT "Order_shop_id_fkey";
    ALTER TABLE "orders" ADD CONSTRAINT "orders_shop_id_fkey"
      FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'ShopFunction_shop_id_fkey') THEN
    ALTER TABLE "shop_functions" DROP CONSTRAINT "ShopFunction_shop_id_fkey";
    ALTER TABLE "shop_functions" ADD CONSTRAINT "shop_functions_shop_id_fkey"
      FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;`,
    description: "Rename FK constraints to match baseline naming",
  });

  // Step 4: Add missing columns to shops
  for (const col of SHOPS_NEW_COLUMNS) {
    const nullable = col.nullable ? "" : " NOT NULL";
    const def = col.default ? ` DEFAULT ${col.default}` : "";
    steps.push({
      sql: `ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}${nullable}${def};`,
      description: `Add shops.${col.name} (${col.type})`,
    });
  }

  // Step 5: Add missing columns to sessions
  for (const col of SESSIONS_NEW_COLUMNS) {
    const nullable = col.nullable ? "" : " NOT NULL";
    const def = col.default ? ` DEFAULT ${col.default}` : "";
    steps.push({
      sql: `ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}${nullable}${def};`,
      description: `Add sessions.${col.name} (${col.type})`,
    });
  }

  // Step 6: Add missing columns to orders
  for (const col of ORDERS_NEW_COLUMNS) {
    const nullable = col.nullable ? "" : " NOT NULL";
    const def = col.default ? ` DEFAULT ${col.default}` : "";
    steps.push({
      sql: `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "${col.name}" ${col.type}${nullable}${def};`,
      description: `Add orders.${col.name} (${col.type})`,
    });
  }

  // Step 7: Convert orders.amount type
  warnings.push(
    "orders.amount: converting from DECIMAL(18,2) to DOUBLE PRECISION (Float).",
    "This may lose precision for values > 2^53. Review if your amounts exceed this.",
  );
  steps.push({
    sql: `ALTER TABLE "orders" ALTER COLUMN "amount" TYPE DOUBLE PRECISION USING "amount"::DOUBLE PRECISION;`,
    description: "Convert orders.amount from DECIMAL to DOUBLE PRECISION",
  });

  // Step 8: Backfill installation_id
  // NOTE: Step 4 already adds the column with DEFAULT gen_random_uuid()::text,
  // which PostgreSQL uses to backfill existing rows automatically.
  // This explicit UPDATE is a safety net for edge cases (e.g., column added
  // manually without DEFAULT, or rows inserted with empty string).
  steps.push({
    sql: `UPDATE "shops" SET "installation_id" = gen_random_uuid()::text WHERE "installation_id" IS NULL OR "installation_id" = '';`,
    description: "Backfill shops.installation_id for existing rows",
  });

  // Step 9: Create missing tables
  steps.push({
    sql: `CREATE TABLE IF NOT EXISTS "operation_leases" (
  "key" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "operation_leases_pkey" PRIMARY KEY ("key")
);`,
    description: "Create operation_leases table",
  });

  steps.push({
    sql: `CREATE TABLE IF NOT EXISTS "webhook_executions" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_executions_shop_webhook_id_handler_id_key"
  ON "webhook_executions"("shop", "webhook_id", "handler_id");
CREATE INDEX IF NOT EXISTS "webhook_executions_shop_created_at_idx"
  ON "webhook_executions"("shop", "created_at");`,
    description: "Create webhook_executions table",
  });

  steps.push({
    sql: `CREATE TABLE IF NOT EXISTS "privacy_requests" (
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
CREATE UNIQUE INDEX IF NOT EXISTS "privacy_requests_shop_webhook_id_key"
  ON "privacy_requests"("shop", "webhook_id");
CREATE INDEX IF NOT EXISTS "privacy_requests_shop_created_at_idx"
  ON "privacy_requests"("shop", "created_at");`,
    description: "Create privacy_requests table",
  });

  // NOTE: We intentionally do NOT write to _prisma_migrations here.
  // Manually inserting rows with hardcoded checksums causes Prisma migration
  // drift detection failures. After running this upgrade tool, use Prisma's
  // official "patching" workflow to reconcile migration history:
  //   https://www.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing

  return { state, steps, warnings };
}
