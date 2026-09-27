/**
 * File: scripts/dev.ts
 * Purpose: Smart dev server launcher.
 *
 * What it does:
 *   1. Auto-setup — if .env missing, runs `npm run setup` automatically
 *   2. Validates environment variables
 *   3. Auto db push — syncs schema to database if tables don't exist
 *   4. Extensions — crash recovery + auto-compile Rust Functions
 *   5. Launches `shopify app dev`
 *
 * Usage:
 *   npm run dev
 */
import { spawn, spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  detectRustToolchain,
  findRustFunctions,
  compileFunctions,
  hashFunctionSources,
  haveFunctionsChanged,
} from "./lib/compile-functions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

// Colors for terminal output
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function log(message: string, color = C.reset) {
  console.log(`${color}${message}${C.reset}`);
}

function step(num: number, total: number, message: string) {
  log(`\n[${num}/${total}] ${message}`, C.cyan);
}

// ─── Parse .env file ────────────────────────────────────────────────────────

function parseEnv(envPath: string): Record<string, string> {
  const content = fs.readFileSync(envPath, "utf-8");
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (key) env[key] = value;
  }
  return env;
}

// ─── Step 0: Auto-setup if .env missing ─────────────────────────────────────

const envPath = path.join(ROOT, ".env");

if (!fs.existsSync(envPath)) {
  log("\n  .env not found — running setup automatically...\n", C.yellow);

  const setupResult = spawnSync("npx", ["tsx", "scripts/setup.ts"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (setupResult.status !== 0) {
    log("\n  Setup failed. Fix the issues and run `npm run dev` again.", C.red);
    process.exit(1);
  }

  // Re-check .env after setup
  if (!fs.existsSync(envPath)) {
    log("\n  .env still not found after setup. Run `npm run setup` manually.", C.red);
    process.exit(1);
  }

  log("\n  Setup complete — continuing to start dev server...\n", C.green);
}

// ─── Step 1: Validate environment ───────────────────────────────────────────

step(1, 4, "Checking environment configuration...");

const env = parseEnv(envPath);

const required = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "DATABASE_URL", "ENCRYPTION_KEY"];
const missing = required.filter((key) => !env[key] || env[key].startsWith("your_"));

if (missing.length > 0) {
  // If only Shopify credentials are missing, warn but continue (dev server may still work via CLI auth)
  const nonShopifyMissing = missing.filter((k) => !k.startsWith("SHOPIFY_"));
  if (nonShopifyMissing.length > 0) {
    log(`  Missing critical variables: ${nonShopifyMissing.join(", ")}`, C.red);
    log(`  Run ${C.cyan}npm run setup${C.reset} to configure.`, C.yellow);
    process.exit(1);
  }
  log("  Shopify credentials not yet configured — some features may not work.", C.yellow);
  log(`  Edit ${C.cyan}.env${C.reset} to add SHOPIFY_API_KEY and SHOPIFY_API_SECRET.`, C.yellow);
} else {
  log("  All required variables are set", C.green);
}

// ─── Step 2: Auto db push ───────────────────────────────────────────────────

step(2, 4, "Checking database...");

const dbUrl = env.DATABASE_URL || "";
const isSqlite = dbUrl.startsWith("file:");

// P0: Verify schema.prisma provider matches DATABASE_URL
const schemaPath = path.join(ROOT, "prisma", "schema.prisma");
if (fs.existsSync(schemaPath)) {
  const schemaContent = fs.readFileSync(schemaPath, "utf-8");
  const providerMatch = schemaContent.match(/datasource\s+db\s*\{[^}]*provider\s*=\s*"([^"]*)"/);
  const schemaProvider = providerMatch?.[1] || "";
  const expectedProvider = isSqlite ? "sqlite" : dbUrl.startsWith("postgresql") || dbUrl.startsWith("postgres") ? "postgresql" : dbUrl.startsWith("mysql") ? "mysql" : "";

  if (expectedProvider && schemaProvider && schemaProvider !== expectedProvider) {
    log(`  ⚠ schema.prisma provider "${schemaProvider}" doesn't match DATABASE_URL (expected "${expectedProvider}")`, C.yellow);
    log(`  Fixing schema.prisma automatically...`, C.yellow);

    // Auto-fix: update provider in schema.prisma
    const fixed = schemaContent.replace(
      /(datasource\s+db\s*\{[^}]*provider\s*=\s*)"[^"]*"/,
      `$1"${expectedProvider}"`,
    );
    fs.writeFileSync(schemaPath, fixed);
    log(`  Fixed: provider → "${expectedProvider}"`, C.green);
  }
}

if (isSqlite) {
  // For SQLite, check if the .db file exists
  const dbFileMatch = dbUrl.match(/^file:\.\/(.+)$/);
  const dbFile = dbFileMatch ? path.join(ROOT, "prisma", dbFileMatch[1]) : null;

  if (!dbFile || !fs.existsSync(dbFile)) {
    log("  Database not initialized — running prisma db push...", C.yellow);
    const pushResult = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
      cwd: ROOT,
      stdio: "pipe",
      timeout: 30_000,
      shell: process.platform === "win32",
    });
    if (pushResult.status === 0) {
      log("  Database tables created", C.green);
    } else {
      const err = pushResult.stderr?.toString().split("\n")[0] || "unknown error";
      log(`  db push failed: ${err}`, C.yellow);
      log(`  Run manually: ${C.cyan}npm run db:push${C.reset}`, C.yellow);
    }
  } else {
    log("  Database ready", C.green);
  }
} else {
  // For PostgreSQL/MySQL, always try db push (fast if already synced)
  log("  Syncing schema...", C.cyan);
  const pushResult = spawnSync("npx", ["prisma", "db", "push", "--skip-generate"], {
    cwd: ROOT,
    stdio: "pipe",
    timeout: 30_000,
    shell: process.platform === "win32",
  });
  if (pushResult.status === 0) {
    log("  Database synced", C.green);
  } else {
    const err = pushResult.stderr?.toString().split("\n")[0] || "unknown error";
    log(`  db push warning: ${err}`, C.yellow);
  }
}

// ─── Step 3: Extensions — crash recovery + auto-compile Functions ───────────

step(3, 4, "Checking Extensions...");

const extensionsDir = path.join(ROOT, "extensions");
const extensionsBackup = path.join(ROOT, "extensions.disabled");

// P0: Crash recovery — if previous run left extensions.disabled, restore it FIRST
if (fs.existsSync(extensionsBackup)) {
  const hasExtensions = fs.existsSync(extensionsDir);
  const extensionsEmpty = !hasExtensions || isDirEmpty(extensionsDir);

  if (extensionsEmpty) {
    try {
      if (hasExtensions) fs.rmSync(extensionsDir, { recursive: true });
      fs.renameSync(extensionsBackup, extensionsDir);
      log("  Restored extensions from previous crash recovery", C.green);
    } catch (err) {
      log("  Failed to restore extensions backup", C.yellow);
    }
  } else {
    try {
      mergeDirSync(extensionsBackup, extensionsDir);
      fs.rmSync(extensionsBackup, { recursive: true });
      log("  Merged and cleaned extensions backup", C.green);
    } catch (err) {
      log("  Failed to merge extensions backup", C.yellow);
    }
  }
}

// Detect Rust toolchain + compile Functions (using shared module)
const toolchain = detectRustToolchain();
const rustFunctions = findRustFunctions(ROOT);

if (toolchain.hasRust && toolchain.hasWasmTarget && rustFunctions.length > 0) {
  // Hash-based change detection — skip recompilation if sources unchanged
  const currentHash = await hashFunctionSources(ROOT, rustFunctions);
  const changed = await haveFunctionsChanged(ROOT, currentHash);

  if (!changed) {
    log("  Functions unchanged — skipping recompilation", C.cyan);
  } else {
    compileFunctions(ROOT, rustFunctions, {
      root: ROOT,
      log: (msg) => log(msg, C.cyan),
      logSuccess: (msg) => log(msg, C.green),
      logWarn: (msg) => log(msg, C.yellow),
      logError: (msg) => log(msg, C.yellow),
      strict: false, // dev mode: don't exit on failure
    });
  }
} else if (rustFunctions.length > 0) {
  const missing = !toolchain.hasRust ? "Rust (cargo)" : "wasm32-unknown-unknown target";
  log(`  ${missing} not found — skipping Function compilation`, C.cyan);
  log("    Functions will still work if pre-built WASM exists", C.cyan);
  log("    Install: rustup target add wasm32-unknown-unknown", C.cyan);
} else {
  log("  No Functions in extensions/ — skip", C.cyan);
}

// ─── Step 4: Launch dev server ──────────────────────────────────────────────

step(4, 4, "Starting Shopify dev server...");

// Check if .shopify config directory exists (app already configured)
const shopifyConfigDir = path.join(ROOT, ".shopify");
const hasShopifyConfig = fs.existsSync(shopifyConfigDir) &&
  fs.existsSync(path.join(shopifyConfigDir, "project.json"));

// Forward all args to shopify app dev
const userArgs = process.argv.slice(2);

// Only use --reset if .shopify config doesn't exist yet (truly first run)
const devArgs = !hasShopifyConfig && !userArgs.includes("--reset")
  ? ["--reset", ...userArgs]
  : userArgs;

if (!hasShopifyConfig) {
  log("  First run — CLI will guide you through app selection.", C.cyan);
  log("    Pick your org and app from the list. It only asks once!\n", C.cyan);
} else {
  log("  App already configured. Starting dev server...", C.green);
}

log("\n  Access your app from Shopify Admin → Apps menu.\n", C.cyan);

const child = spawn("npx", ["shopify", "app", "dev", ...devArgs], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32", // Windows needs shell for npx
});

child.on("error", (err) => {
  log(`  Failed to start: ${err.message}`, C.red);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code || 0);
});

// Graceful exit on Ctrl+C, kill, or unexpected error
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
process.on("uncaughtException", (err) => {
  log(`  Uncaught error: ${err.message}`, C.red);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (for crash recovery in Step 3)
// ─────────────────────────────────────────────────────────────────────────────

// Check if directory is empty (ignoring .gitkeep)
function isDirEmpty(dir: string): boolean {
  const entries = fs.readdirSync(dir).filter((f) => f !== ".gitkeep");
  return entries.length === 0;
}

// Merge files from src to dest (only adds missing files, never overwrites)
function mergeDirSync(src: string, dest: string) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      mergeDirSync(srcPath, destPath);
    } else if (!fs.existsSync(destPath)) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
