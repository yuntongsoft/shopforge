/**
 * File: scripts/clean-demo.ts
 * Purpose: Remove demo/example code from the scaffold, leaving only infrastructure.
 *
 * This script is for developers who want to start fresh with their own business logic.
 * It removes all demo code while preserving the core infrastructure.
 *
 * Usage:
 *   pnpm clean:demo          # Remove demo code (interactive confirmation)
 *   pnpm clean:demo --force  # Skip confirmation
 *
 * What gets removed:
 *   - app/demo/              — All demo services, tests, and README
 *   - 4 demo route files     — app.order, app.discounts, app.theme-widget, app.pricing
 *   - Demo templates/        — Rust Function templates
 *   - Demo nav entries       — From app.tsx NavMenu
 *   - Order + ShopFunction   — From Prisma schema
 *   - Demo seed data         — Replaced with minimal seed
 *
 * What stays:
 *   - All infrastructure (auth, billing, webhook, security, i18n, health)
 *   - Core routes: app._index.tsx, app.settings.tsx, auth/*, health.tsx, webhooks.tsx
 *   - Core services: billing.service.ts, email.ts, shopify/*, webhook-registry.ts
 *   - All utilities, components, and infrastructure tests
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Directories to delete entirely
const DEMO_DIRS = [
  "app/demo",
  "tests/demo",
  "templates/order-discount-rust",
  "templates/hello-function-rust",
];

// Individual route files to delete
const DEMO_ROUTES = [
  "app/routes/app.order.tsx",
  "app/routes/app.discounts.tsx",
  "app/routes/app.theme-widget.tsx",
  "app/routes/app.pricing.tsx",
];

// Nav entries to remove from app.tsx
const DEMO_NAV_ENTRIES = [
  "/app/order",
  "/app/discounts",
  "/app/theme-widget",
  "/app/pricing",
];

async function confirm(message: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/N) `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function deletePath(relativePath: string): boolean {
  const fullPath = path.join(ROOT, relativePath);
  if (!fs.existsSync(fullPath)) {
    return false;
  }

  const stat = fs.statSync(fullPath);
  if (stat.isDirectory()) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  } else {
    fs.unlinkSync(fullPath);
  }
  return true;
}

function updateAppTsx(): void {
  const appTsxPath = path.join(ROOT, "app/routes/app.tsx");
  if (!fs.existsSync(appTsxPath)) return;

  let content = fs.readFileSync(appTsxPath, "utf-8");

  for (const entry of DEMO_NAV_ENTRIES) {
    const regex = new RegExp(`\\s*<a href="${entry.replace(/\//g, "\\/")}".*?</a>`, "g");
    content = content.replace(regex, "");
  }

  fs.writeFileSync(appTsxPath, content);
  console.log("  ✓ Updated app/routes/app.tsx (removed demo nav entries)");
}

function updatePrismaSchema(): void {
  const schemaPath = path.join(ROOT, "prisma/schema.prisma");
  if (!fs.existsSync(schemaPath)) return;

  let content = fs.readFileSync(schemaPath, "utf-8");

  // Remove Order model
  content = content.replace(/\/\/\/ Order —[\s\S]*?model Order \{[\s\S]*?\n\}\n/g, "");

  // Remove ShopFunction model
  content = content.replace(/\/\/\/ ShopFunction —[\s\S]*?model ShopFunction \{[\s\S]*?\n\}\n/g, "");

  // Remove shopFunctions relation from Shop model
  content = content.replace(/\n  shopFunctions ShopFunction\[\]\n/g, "\n");

  fs.writeFileSync(schemaPath, content);
  console.log("  ✓ Updated prisma/schema.prisma (removed Order + ShopFunction models)");
}

function updateSeedScript(): void {
  const seedPath = path.join(ROOT, "scripts/seed.ts");
  if (!fs.existsSync(seedPath)) return;

  const minimalSeed = `/**
 * File: scripts/seed.ts
 * Purpose: Seed the database with test data for local development.
 *
 * Usage:
 *   pnpm db:seed
 *
 * Customize this script with your own demo data.
 */
import { PrismaClient } from "@prisma/client";
import { encrypt } from "../app/utils/encryption";

const prisma = new PrismaClient();

async function main() {
  console.log("[seed] Starting database seed...\\n");

  // Create demo shop
  const demoShop = await prisma.shop.upsert({
    where: { shopifyDomain: "demo-store.myshopify.com" },
    update: {},
    create: {
      shopifyDomain: "demo-store.myshopify.com",
      shopifyToken: encrypt("shpat_demo_token_for_local_dev_only"),
      shopifyScope: "read_products,write_products,read_orders",
      plan: "free",
      isDeleted: false,
    },
  });
  console.log(\`✓ Shop: \${demoShop.shopifyDomain} (id: \${demoShop.id})\`);

  // TODO: Add your own demo data here

  console.log("\\n[seed] Done!");
}

main()
  .catch((e) => {
    console.error("[seed] Failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
`;

  fs.writeFileSync(seedPath, minimalSeed);
  console.log("  ✓ Updated scripts/seed.ts (removed demo data)");
}

async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");

  console.log("[clean] ShopForge Demo Cleanup\n");
  console.log("This will remove all demo/example code from the scaffold.\n");

  console.log("Directories to delete:");
  for (const dir of DEMO_DIRS) {
    const exists = fs.existsSync(path.join(ROOT, dir));
    console.log(`  ${exists ? "⚠" : " "} ${dir}${exists ? "" : " (not found)"}`);
  }

  console.log("\nRoute files to delete:");
  for (const route of DEMO_ROUTES) {
    const exists = fs.existsSync(path.join(ROOT, route));
    console.log(`  ${exists ? "⚠" : " "} ${route}${exists ? "" : " (not found)"}`);
  }

  console.log("\nSource files to update:");
  console.log("  • app/routes/app.tsx (remove demo nav entries)");
  console.log("  • prisma/schema.prisma (remove Order + ShopFunction models)");
  console.log("  • scripts/seed.ts (remove demo data)");
  console.log("");
  console.log("Note: app/routes/ demo wrappers (app.order.tsx etc.) will be deleted.");
  console.log("      The actual components live in app/demo/routes/ and are deleted with app/demo/.");

  if (!force) {
    const ok = await confirm("\nContinue?");
    if (!ok) {
      console.log("\n[clean] Aborted.");
      process.exit(0);
    }
  }

  console.log("\n[clean] Removing demo directories...");
  let deleted = 0;
  for (const dir of DEMO_DIRS) {
    if (deletePath(dir)) {
      console.log(`  ✓ Deleted: ${dir}/`);
      deleted++;
    }
  }

  console.log("\n[clean] Removing demo route files...");
  for (const route of DEMO_ROUTES) {
    if (deletePath(route)) {
      console.log(`  ✓ Deleted: ${route}`);
      deleted++;
    }
  }

  console.log("\n[clean] Updating source files...");
  updateAppTsx();
  updatePrismaSchema();
  updateSeedScript();

  console.log(`\n[clean] Done! Removed ${deleted} items.`);
  console.log("\nNext steps:");
  console.log("  1. Run: pnpm db:push  (sync schema changes)");
  console.log("  2. Run: pnpm dev      (start development)");
  console.log("  3. Start building your business logic!");
}

main().catch((e) => {
  console.error("[clean] Failed:", e);
  process.exit(1);
});

