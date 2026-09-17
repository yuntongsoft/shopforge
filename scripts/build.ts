/**
 * File: scripts/build.ts
 * Purpose: Production build — auto-compiles Functions before Remix build.
 *
 * Developers just run: npm run build
 * This script handles:
 *   1. Detect & compile Rust Functions (if any)
 *   2. Run remix vite:build
 *
 * No need to know about cargo, wasm, or shopify app deploy.
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  detectRustToolchain,
  findRustFunctions,
  compileFunctions,
} from "./lib/compile-functions.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
};

function log(msg: string, color = colors.reset) {
  console.log(`${color}${msg}${colors.reset}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1: Compile Functions (if Rust toolchain available)
// ─────────────────────────────────────────────────────────────────────────────
log("\n[1/2] Checking Functions...", colors.cyan);

const toolchain = detectRustToolchain();
const rustFunctions = findRustFunctions(ROOT);

if (toolchain.hasRust && toolchain.hasWasmTarget && rustFunctions.length > 0) {
  compileFunctions(ROOT, rustFunctions, {
    root: ROOT,
    log: (msg) => log(msg, colors.cyan),
    logSuccess: (msg) => log(msg, colors.green),
    logWarn: (msg) => log(msg, colors.cyan),
    logError: (msg) => log(msg, colors.red),
    strict: true, // build mode: exit on failure
  });
} else if (rustFunctions.length > 0) {
  const missing = !toolchain.hasRust ? "Rust (cargo)" : "wasm32-unknown-unknown target";
  log(`  ℹ ${missing} not found — using pre-built WASM if available`, colors.cyan);
} else {
  log("  ℹ No Functions to compile — skip", colors.cyan);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2: Run Remix build
// ─────────────────────────────────────────────────────────────────────────────
log("\n[2/2] Building application...", colors.cyan);

try {
  execSync("npx remix vite:build", {
    cwd: ROOT,
    stdio: "inherit",
  });
  log("\n  ✓ Build complete!\n", colors.green);
} catch (err) {
  log("\n  ✗ Build failed\n", colors.red);
  process.exit(1);
}
