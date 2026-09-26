/**
 * File: scripts/upgrade-db.ts
 * Purpose: Upgrade an existing ShopForge database from the old init migration
 *          (PascalCase tables, missing columns) to the current baseline.
 *
 * Workflow: detect state → compute plan → validate → optionally execute.
 * Supports --dry-run (default) and --apply --force.
 *
 * IMPORTANT:
 *   - This tool ONLY targets PostgreSQL.
 *   - It NEVER resets the database or deletes business records.
 *   - It aborts on conflicts (mixed naming, unknown states, type risks).
 *   - Docker/normal startup runs `prisma migrate deploy` only.
 *     This tool is for explicit old-database repair.
 *
 * Usage:
 *   npm run upgrade:db                  # Dry-run — detect state, show plan
 *   npm run upgrade:db -- --apply       # Execute upgrade (with confirmation)
 *   npm run upgrade:db -- --apply --force  # Skip confirmation
 */
import { PrismaClient } from "@prisma/client";
import {
  classifyState,
  computePlan,
  CURRENT_TABLES,
  type DbState,
} from "./lib/upgrade-db.js";

/* ── Detection (requires DB connection) ─────────────────────────────────── */

/**
 * Detect the current database state by inspecting existing tables.
 */
async function detectState(prisma: PrismaClient): Promise<DbState> {
  let tables: string[];
  try {
    const result = await prisma.$queryRaw<Array<{ tablename: string }>>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;
    tables = result.map((r) => r.tablename);
  } catch {
    return { kind: "unknown_provider", provider: "non-postgresql" };
  }

  return classifyState(tables);
}

/* ── Validation ─────────────────────────────────────────────────────────── */

/**
 * Validate database integrity after upgrade.
 * Returns an array of error messages (empty = success).
 */
async function validatePostUpgrade(prisma: PrismaClient): Promise<string[]> {
  const errors: string[] = [];

  const result = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const tables = result.map((r) => r.tablename);

  for (const expected of CURRENT_TABLES) {
    if (!tables.includes(expected)) {
      errors.push(`Missing table after upgrade: ${expected}`);
    }
  }

  // Verify each core table is queryable (no data loss)
  for (const table of ["shops", "sessions", "orders", "shop_functions"]) {
    if (!tables.includes(table)) continue;
    try {
      await prisma.$queryRawUnsafe(`SELECT count(*) FROM "${table}"`);
    } catch (e) {
      errors.push(`Cannot query table "${table}" after upgrade: ${e}`);
    }
  }

  return errors;
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const force = args.includes("--force");
  const dryRun = !apply;

  console.log("[upgrade-db] ShopForge Database Upgrade Tool\n");

  const prisma = new PrismaClient();

  try {
    // 1. Detect state
    console.log("[upgrade-db] Detecting database state...");
    const state = await detectState(prisma);
    console.log(`[upgrade-db] Detected: ${state.kind}\n`);

    // 2. Compute plan
    const plan = computePlan(state);

    // 3. Print warnings
    if (plan.warnings.length > 0) {
      console.log("WARNINGS:");
      for (const w of plan.warnings) {
        console.log(`  ⚠ ${w}`);
      }
      console.log("");
    }

    // 4. Handle non-upgradable states
    if (
      state.kind === "mixed" ||
      state.kind === "failed_migration" ||
      state.kind === "unknown_provider"
    ) {
      console.log("[upgrade-db] ABORT: Database state requires manual intervention.");
      console.log("[upgrade-db] Please resolve conflicts and re-run.");
      process.exit(1);
    }

    // 5. Handle no-op states
    if (state.kind === "fresh") {
      console.log("[upgrade-db] Fresh database detected. Run: npx prisma migrate deploy");
      return;
    }

    if (state.kind === "current") {
      console.log("[upgrade-db] Database is already up to date. No action needed.");
      return;
    }

    // 6. Print plan
    if (dryRun) {
      console.log("[upgrade-db] Dry-run — no changes will be made.\n");
    }

    console.log(`Planned steps (${plan.steps.length}):`);
    for (let i = 0; i < plan.steps.length; i++) {
      console.log(`  ${i + 1}. ${plan.steps[i].description}`);
    }
    console.log("");

    if (dryRun) {
      console.log("To apply these changes:");
      console.log("  npm run upgrade:db -- --apply");
      return;
    }

    // 7. Confirm
    if (!force) {
      const readline = await import("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question("Continue with upgrade? (y/N) ", resolve);
      });
      rl.close();
      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("[upgrade-db] Aborted.");
        return;
      }
    }

    // 8. Execute
    console.log("[upgrade-db] Executing upgrade steps...\n");
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      try {
        await prisma.$executeRawUnsafe(step.sql);
        console.log(`  ✓ ${i + 1}/${plan.steps.length} ${step.description}`);
      } catch (e) {
        console.error(`  ✗ ${i + 1}/${plan.steps.length} FAILED: ${step.description}`);
        console.error(`    Error: ${e}`);
        console.error("\n[upgrade-db] ABORT: Upgrade failed mid-execution.");
        console.error("[upgrade-db] Database may be in a partial state. Review and retry.");
        process.exit(1);
      }
    }

    // 9. Validate
    console.log("\n[upgrade-db] Validating post-upgrade integrity...");
    const validationErrors = await validatePostUpgrade(prisma);
    if (validationErrors.length > 0) {
      console.error("\nVALIDATION ERRORS:");
      for (const e of validationErrors) {
        console.error(`  ✗ ${e}`);
      }
      process.exit(1);
    }

    console.log("  ✓ All tables present and accessible.\n");
    console.log("[upgrade-db] Upgrade complete!");
    console.log("\nNext steps:");
    console.log("  1. Run: npx prisma generate  (regenerate client)");
    console.log("  2. Run: npm run dev          (start development)");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error("[upgrade-db] Failed:", e);
  process.exit(1);
});
