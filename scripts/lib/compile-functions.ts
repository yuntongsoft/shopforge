/**
 * File: scripts/lib/compile-functions.ts
 * Purpose: Shared Rust Function compilation logic — used by both dev.ts and build.ts.
 *
 * Provides:
 *   - detectRustToolchain() — check cargo + wasm32 target
 *   - findRustFunctions()   — scan extensions/ for Cargo.toml projects
 *   - compileFunctions()    — cargo build all detected Functions
 *   - hashSources()         — content hash for change detection (dev mode skip)
 *
 * Dependencies: child_process, fs, path, crypto
 * Used by: scripts/dev.ts, scripts/build.ts
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RustToolchain {
  hasRust: boolean;
  hasWasmTarget: boolean;
}

export interface CompileOptions {
  /** Project root directory */
  root: string;
  /** Log functions for output */
  log: (msg: string) => void;
  logSuccess: (msg: string) => void;
  logWarn: (msg: string) => void;
  logError: (msg: string) => void;
  /** If true, exit on failure (build mode). If false, continue (dev mode). */
  strict: boolean;
}

export interface CompileResult {
  /** Whether compilation was attempted and succeeded */
  success: boolean;
  /** Number of Functions compiled */
  compiled: number;
  /** Whether compilation was skipped (no functions or unchanged) */
  skipped: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect Rust toolchain availability.
 */
export function detectRustToolchain(): RustToolchain {
  let hasRust = false;
  let hasWasmTarget = false;

  try {
    execSync("cargo --version", { stdio: "pipe" });
    hasRust = true;
    const targets = execSync("rustup target list --installed", { stdio: "pipe" }).toString();
    hasWasmTarget = targets.includes("wasm32-unknown-unknown");
  } catch {
    // Rust toolchain not available
  }

  return { hasRust, hasWasmTarget };
}

/**
 * Scan extensions/ directory for Rust Function projects (directories with Cargo.toml).
 */
export function findRustFunctions(root: string): string[] {
  const extensionsDir = path.join(root, "extensions");
  if (!fs.existsSync(extensionsDir)) return [];

  return fs
    .readdirSync(extensionsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(extensionsDir, e.name, "Cargo.toml")))
    .map((e) => e.name);
}

// ─────────────────────────────────────────────────────────────────────────────
// Compilation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compile all detected Rust Functions.
 *
 * @returns CompileResult with success status and count
 */
export function compileFunctions(
  root: string,
  functionNames: string[],
  opts: CompileOptions
): CompileResult {
  const { log, logSuccess, logWarn, logError, strict } = opts;
  const extensionsDir = path.join(root, "extensions");

  if (functionNames.length === 0) {
    log("  ℹ No Functions to compile — skip");
    return { success: true, compiled: 0, skipped: true };
  }

  log("  ✓ Compiling Functions...");
  let compiled = 0;
  let allOk = true;

  for (const name of functionNames) {
    const funcDir = path.join(extensionsDir, name);
    try {
      execSync("cargo build --target wasm32-unknown-unknown --release", {
        cwd: funcDir,
        stdio: "pipe",
      });
      logSuccess(`    ✓ ${name} compiled`);
      compiled++;
    } catch (err) {
      logError(`    ✗ ${name} compilation failed`);
      allOk = false;
    }
  }

  if (!allOk && strict) {
    logError("\n  ✗ Function compilation failed. Please fix errors and retry.");
    process.exit(1);
  }

  if (!allOk && !strict) {
    logWarn("  ⚠ Some Functions failed — Shopify CLI will report the error");
  }

  return { success: allOk, compiled, skipped: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hash-based change detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 hash of all Rust source files + Cargo.toml.
 * Used to skip recompilation when sources haven't changed.
 *
 * @returns hex digest string
 */
export async function hashFunctionSources(
  root: string,
  functionNames: string[]
): Promise<string> {
  const crypto = await import("crypto");
  const hash = crypto.createHash("sha256");
  const extensionsDir = path.join(root, "extensions");

  for (const name of functionNames) {
    const funcDir = path.join(extensionsDir, name);
    const srcDir = path.join(funcDir, "src");

    if (fs.existsSync(srcDir)) {
      const srcFiles = fs.readdirSync(srcDir).filter((f) => f.endsWith(".rs")).sort();
      for (const f of srcFiles) {
        hash.update(fs.readFileSync(path.join(srcDir, f)));
      }
    }

    const cargoFile = path.join(funcDir, "Cargo.toml");
    if (fs.existsSync(cargoFile)) {
      hash.update(fs.readFileSync(cargoFile));
    }
  }

  return hash.digest("hex");
}

/**
 * Check if Function sources have changed since last compilation.
 * Stores hash in .shopify/functions-hash.txt.
 *
 * @returns true if sources changed (or first run)
 */
export async function haveFunctionsChanged(
  root: string,
  currentHash: string
): Promise<boolean> {
  const hashFile = path.join(root, ".shopify", "functions-hash.txt");

  if (fs.existsSync(hashFile)) {
    const prevHash = fs.readFileSync(hashFile, "utf-8").trim();
    if (prevHash === currentHash) {
      return false; // unchanged
    }
  }

  // Save new hash
  const shopifyDir = path.join(root, ".shopify");
  if (!fs.existsSync(shopifyDir)) fs.mkdirSync(shopifyDir, { recursive: true });
  fs.writeFileSync(hashFile, currentHash);

  return true; // changed
}
