import { describe, expect, it } from "vitest";
import {
  classifyState,
  computePlan,
  LEGACY_TABLES,
  CURRENT_TABLES,
  TABLE_RENAME_MAP,
  SHOPS_NEW_COLUMNS,
  SESSIONS_NEW_COLUMNS,
  ORDERS_NEW_COLUMNS,
} from "../../scripts/lib/upgrade-db";

describe("classifyState", () => {
  it("returns fresh for empty database", () => {
    expect(classifyState([])).toEqual({ kind: "fresh" });
  });

  it("returns current when all baseline tables exist", () => {
    const tables = [...CURRENT_TABLES];
    expect(classifyState(tables)).toEqual({ kind: "current" });
  });

  it("returns current even with extra unrelated tables", () => {
    const tables = [...CURRENT_TABLES, "custom_table", "audit_log"];
    expect(classifyState(tables)).toEqual({ kind: "current" });
  });

  it("returns legacy when only PascalCase tables exist", () => {
    const tables = [...LEGACY_TABLES];
    const state = classifyState(tables);
    expect(state.kind).toBe("legacy");
    if (state.kind === "legacy") {
      expect(state.legacyTables).toEqual([...LEGACY_TABLES]);
    }
  });

  it("returns legacy with partial old tables", () => {
    const state = classifyState(["Shop", "Session"]);
    expect(state.kind).toBe("legacy");
    if (state.kind === "legacy") {
      expect(state.legacyTables).toEqual(["Shop", "Session"]);
    }
  });

  it("returns mixed when both legacy and current tables coexist", () => {
    const state = classifyState(["Shop", "shops", "sessions"]);
    expect(state.kind).toBe("mixed");
    if (state.kind === "mixed") {
      expect(state.legacyTables).toContain("Shop");
      expect(state.currentTables).toContain("shops");
      expect(state.currentTables).toContain("sessions");
    }
  });

  it("returns failed_migration when some current tables are missing", () => {
    const partial = ["shops", "sessions"]; // missing orders, shop_functions, etc.
    const state = classifyState(partial);
    expect(state.kind).toBe("failed_migration");
    if (state.kind === "failed_migration") {
      expect(state.details).toContain("orders");
      expect(state.details).toContain("shop_functions");
    }
  });
});

describe("computePlan — fresh/current", () => {
  it("returns empty plan for fresh database", () => {
    const plan = computePlan({ kind: "fresh" });
    expect(plan.steps).toHaveLength(0);
    expect(plan.warnings).toHaveLength(0);
  });

  it("returns empty plan for current database", () => {
    const plan = computePlan({ kind: "current" });
    expect(plan.steps).toHaveLength(0);
    expect(plan.warnings).toHaveLength(0);
  });
});

describe("computePlan — conflict states", () => {
  it("returns warnings and no steps for mixed state", () => {
    const plan = computePlan({
      kind: "mixed",
      legacyTables: ["Shop"],
      currentTables: ["shops"],
    });
    expect(plan.steps).toHaveLength(0);
    expect(plan.warnings.length).toBeGreaterThan(0);
    expect(plan.warnings.some((w) => w.includes("CONFLICT"))).toBe(true);
  });

  it("returns warnings and no steps for failed migration", () => {
    const plan = computePlan({
      kind: "failed_migration",
      details: "Missing tables: orders",
    });
    expect(plan.steps).toHaveLength(0);
    expect(plan.warnings.some((w) => w.includes("FAILED MIGRATION"))).toBe(true);
  });

  it("returns warnings for unknown provider", () => {
    const plan = computePlan({
      kind: "unknown_provider",
      provider: "mysql",
    });
    expect(plan.steps).toHaveLength(0);
    expect(plan.warnings.some((w) => w.includes("PostgreSQL"))).toBe(true);
  });
});

describe("computePlan — legacy upgrade", () => {
  const legacyState = { kind: "legacy" as const, legacyTables: [...LEGACY_TABLES] };

  it("generates steps for full legacy upgrade", () => {
    const plan = computePlan(legacyState);
    expect(plan.steps.length).toBeGreaterThan(0);
    // Should include table renames
    const renameSteps = plan.steps.filter((s) => s.description.includes("Rename"));
    expect(renameSteps.length).toBeGreaterThanOrEqual(4); // 4 tables + indexes + FKs
  });

  it("includes DROP FK step for Session", () => {
    const plan = computePlan(legacyState);
    const dropFk = plan.steps.find((s) => s.description.includes("Drop Session"));
    expect(dropFk).toBeDefined();
    expect(dropFk!.sql).toContain("Session_shop_fkey");
  });

  it("includes table rename steps for all legacy tables", () => {
    const plan = computePlan(legacyState);
    for (const [legacy, current] of Object.entries(TABLE_RENAME_MAP)) {
      const step = plan.steps.find(
        (s) => s.sql.includes(`"${legacy}"`) && s.sql.includes(`"${current}"`) && s.sql.includes("RENAME"),
      );
      expect(step, `Missing rename for ${legacy} → ${current}`).toBeDefined();
    }
  });

  it("includes column additions for shops", () => {
    const plan = computePlan(legacyState);
    for (const col of SHOPS_NEW_COLUMNS) {
      const step = plan.steps.find(
        (s) => s.description === `Add shops.${col.name} (${col.type})`,
      );
      expect(step, `Missing column addition for shops.${col.name}`).toBeDefined();
    }
  });

  it("includes column additions for sessions", () => {
    const plan = computePlan(legacyState);
    for (const col of SESSIONS_NEW_COLUMNS) {
      const step = plan.steps.find(
        (s) => s.description === `Add sessions.${col.name} (${col.type})`,
      );
      expect(step, `Missing column addition for sessions.${col.name}`).toBeDefined();
    }
  });

  it("includes column additions for orders", () => {
    const plan = computePlan(legacyState);
    for (const col of ORDERS_NEW_COLUMNS) {
      const step = plan.steps.find(
        (s) => s.description === `Add orders.${col.name} (${col.type})`,
      );
      expect(step, `Missing column addition for orders.${col.name}`).toBeDefined();
    }
  });

  it("includes DECIMAL → DOUBLE PRECISION conversion with warning", () => {
    const plan = computePlan(legacyState);
    const convertStep = plan.steps.find((s) =>
      s.description.includes("DOUBLE PRECISION"),
    );
    expect(convertStep).toBeDefined();
    expect(plan.warnings.some((w) => w.includes("DECIMAL"))).toBe(true);
  });

  it("creates missing infrastructure tables", () => {
    const plan = computePlan(legacyState);
    const createSteps = plan.steps.filter((s) =>
      s.description.startsWith("Create"),
    );
    const tableNames = createSteps.map((s) => s.description);
    expect(tableNames).toContain("Create operation_leases table");
    expect(tableNames).toContain("Create webhook_executions table");
    expect(tableNames).toContain("Create privacy_requests table");
  });

  it("does NOT write to _prisma_migrations (avoids Prisma drift)", () => {
    const plan = computePlan(legacyState);
    const registerStep = plan.steps.find((s) =>
      s.description.includes("_prisma_migrations") || s.sql.includes("_prisma_migrations"),
    );
    expect(registerStep).toBeUndefined();
  });

  it("handles partial legacy state (only some old tables)", () => {
    const partialState = { kind: "legacy" as const, legacyTables: ["Shop", "Session"] };
    const plan = computePlan(partialState);
    // Should still generate steps, but only for existing tables
    const renameSteps = plan.steps.filter(
      (s) => s.sql.includes("RENAME TO") && !s.sql.includes("INDEX"),
    );
    expect(renameSteps).toHaveLength(2); // Only Shop and Session
  });

  it("never generates DROP TABLE or DELETE statements", () => {
    const plan = computePlan(legacyState);
    for (const step of plan.steps) {
      expect(step.sql).not.toMatch(/DROP\s+TABLE/i);
      expect(step.sql).not.toMatch(/DELETE\s+FROM/i);
      expect(step.sql).not.toMatch(/TRUNCATE/i);
    }
  });
});
