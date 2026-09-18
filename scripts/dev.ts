/**
 * File: scripts/dev.ts
 * Purpose: Smart dev server launcher — auto-handles Shopify CLI URL configuration
 *          so developers don't need to understand tunnel URL synchronization.
 *
 * What it does:
 *   1. Checks if .env exists, creates from .env.example if not
 *   2. Validates required environment variables
 *   3. Pushes Prisma schema to database
 *   4. Checks Extensions — crash recovery + auto-compile Rust Functions
 *   5. Launches `shopify app dev` with proper configuration
 *
 * Usage:
 *   npm run dev
 */
import { execSync, spawn } from "child_process";
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
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function step(num: number, total: number, message: string) {
  log(`\n[${num}/${total}] ${message}`, colors.cyan);
}

// === Step 1: Check .env ===
step(1, 5, "Checking environment configuration...");

const envPath = path.join(ROOT, ".env");
const envExamplePath = path.join(ROOT, ".env.example");

if (!fs.existsSync(envPath)) {
  if (fs.existsSync(envExamplePath)) {
    fs.copyFileSync(envExamplePath, envPath);
    log("  ✓ Created .env from .env.example", colors.green);
    log("  ⚠ Please fill in the required values in .env and run `npm run dev` again.", colors.yellow);
    
    // Generate encryption key
    try {
      const crypto = await import("crypto");
      const key = crypto.randomBytes(32).toString("hex");
      let envContent = fs.readFileSync(envPath, "utf-8");
      envContent = envContent.replace("ENCRYPTION_KEY=", `ENCRYPTION_KEY=${key}`);
      fs.writeFileSync(envPath, envContent);
      log("  ✓ Auto-generated ENCRYPTION_KEY", colors.green);
    } catch {
      log("  ⚠ Could not auto-generate ENCRYPTION_KEY. Please generate manually.", colors.yellow);
    }
    
    process.exit(0);
  } else {
    log("  ✗ .env.example not found!", colors.red);
    process.exit(1);
  }
} else {
  log("  ✓ .env exists", colors.green);
}

// === Step 2: Validate required env vars ===
step(2, 5, "Validating environment variables...");

// Load .env manually since we're not using dotenv
const envContent = fs.readFileSync(envPath, "utf-8");
const env: Record<string, string> = {};
for (const rawLine of envContent.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;
  const eqIndex = line.indexOf("=");
  if (eqIndex === -1) continue;
  const key = line.slice(0, eqIndex).trim();
  const value = line.slice(eqIndex + 1).trim();
  if (key) env[key] = value;
}

const required = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "DATABASE_URL", "ENCRYPTION_KEY"];
const missing = required.filter((key) => !env[key] || env[key].startsWith("your_"));

if (missing.length > 0) {
  log(`  ✗ Missing required variables: ${missing.join(", ")}`, colors.red);
  log("  Please edit .env and fill in the values, then run `npm run dev` again.", colors.yellow);
  process.exit(1);
}
log("  ✓ All required variables are set", colors.green);

// Auto-generate CSRF_SECRET if empty (prevents runtime crashes in form actions)
if (!env.CSRF_SECRET) {
  try {
    const crypto = await import("crypto");
    const secret = crypto.randomBytes(32).toString("hex");
    let content = fs.readFileSync(envPath, "utf-8");
    content = content.replace(/^CSRF_SECRET=.*$/m, `CSRF_SECRET=${secret}`);
    fs.writeFileSync(envPath, content);
    log("  ✓ Auto-generated CSRF_SECRET", colors.green);
  } catch {
    log("  ⚠ Could not auto-generate CSRF_SECRET. Please generate manually.", colors.yellow);
  }
}

// === Step 3: Database setup ===
step(3, 5, "Syncing database schema...");

try {
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    cwd: ROOT,
    stdio: "pipe",
  });
  log("  ✓ Database schema synced", colors.green);
} catch (error) {
  log("  ⚠ Database sync failed. If this is your first run, please run `npm run db:push` manually.", colors.yellow);
}

// === Step 4: Extensions — crash recovery + auto-compile Functions ===
step(4, 5, "Checking Extensions...");

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
      log("  ✓ Restored extensions from previous crash recovery", colors.green);
    } catch (err) {
      log("  ⚠ Failed to restore extensions backup", colors.yellow);
    }
  } else {
    try {
      mergeDirSync(extensionsBackup, extensionsDir);
      fs.rmSync(extensionsBackup, { recursive: true });
      log("  ✓ Merged and cleaned extensions backup", colors.green);
    } catch (err) {
      log("  ⚠ Failed to merge extensions backup", colors.yellow);
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
    log("  ℹ Functions unchanged — skipping recompilation", colors.cyan);
  } else {
    compileFunctions(ROOT, rustFunctions, {
      root: ROOT,
      log: (msg) => log(msg, colors.cyan),
      logSuccess: (msg) => log(msg, colors.green),
      logWarn: (msg) => log(msg, colors.yellow),
      logError: (msg) => log(msg, colors.yellow),
      strict: false, // dev mode: don't exit on failure
    });
  }
} else if (rustFunctions.length > 0) {
  const missing = !toolchain.hasRust ? "Rust (cargo)" : "wasm32-unknown-unknown target";
  log(`  ℹ ${missing} not found — skipping Function compilation`, colors.cyan);
  log("    Functions will still work if pre-built WASM exists", colors.cyan);
  log("    Install: rustup target add wasm32-unknown-unknown", colors.cyan);
} else {
  log("  ℹ No Functions in extensions/ — skip", colors.cyan);
}

// === Step 5: Launch dev server ===
step(5, 5, "Starting Shopify dev server...");

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
  log("  ℹ First run detected — CLI will guide you through app selection.", colors.cyan);
  log("    Just pick your org and app from the list. It only asks once!\n", colors.cyan);
} else {
  log("  ✓ App already configured. Starting dev server...", colors.green);
}

log("\n  Access your app from Shopify Admin → Apps menu.\n", colors.cyan);

const child = spawn("npx", ["shopify", "app", "dev", ...devArgs], {
  cwd: ROOT,
  stdio: "inherit",
  shell: process.platform === "win32", // Windows needs shell for npx
});

child.on("error", (err) => {
  log(`  ✗ Failed to start: ${err.message}`, colors.red);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code || 0);
});

// Graceful exit on Ctrl+C, kill, or unexpected error
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
process.on("uncaughtException", (err) => {
  log(`  ✗ Uncaught error: ${err.message}`, colors.red);
  process.exit(1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (for crash recovery in Step 4)
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
