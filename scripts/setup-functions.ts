/**
 * File: scripts/setup-functions.ts
 * Purpose: Set up Shopify Function templates for development.
 *
 * Copies Function templates from templates/ to extensions/ so they can be
 * deployed via `shopify app deploy`. This bridges the gap between the scaffold
 * and a working Function deployment pipeline.
 *
 * Usage:
 *   pnpm functions:setup          # Copy all templates
 *   pnpm functions:setup --clean  # Remove existing extensions first
 *
 * After running:
 *   1. Review each extension's shopify.function.extension.toml
 *   2. Run: npx shopify app deploy
 *   3. Function GIDs will be auto-registered in the database
 *
 * Prerequisites:
 *   - Rust toolchain with wasm32-wasi target
 *   - cargo-wasi: cargo install cargo-wasi
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const TEMPLATES_DIR = path.join(ROOT, "templates");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");

/**
 * Recursively copy a directory, skipping node_modules and target dirs.
 */
function copyDir(src: string, dest: string): number {
  let count = 0;
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "target") continue;

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      count += copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }
  return count;
}

async function main() {
  const args = process.argv.slice(2);
  const clean = args.includes("--clean");

  console.log("[functions] ShopForge Function Setup\n");

  // 1. Check templates exist
  if (!fs.existsSync(TEMPLATES_DIR)) {
    console.error("[functions] ERROR: templates/ directory not found.");
    console.error("[functions] This script must be run from the project root.");
    process.exit(1);
  }

  const templates = fs.readdirSync(TEMPLATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  if (templates.length === 0) {
    console.error("[functions] ERROR: No templates found in templates/.");
    process.exit(1);
  }

  console.log(`Found ${templates.length} template(s): ${templates.join(", ")}\n`);

  // 2. Clean if requested
  if (clean) {
    console.log("[functions] --clean: removing existing extensions/...");
    fs.rmSync(EXTENSIONS_DIR, { recursive: true, force: true });
  }

  // 3. Create extensions directory
  fs.mkdirSync(EXTENSIONS_DIR, { recursive: true });

  // Keep .gitkeep for empty state tracking
  const gitkeep = path.join(EXTENSIONS_DIR, ".gitkeep");
  if (!fs.existsSync(gitkeep)) {
    fs.writeFileSync(gitkeep, "");
  }

  // 4. Copy each template
  let totalFiles = 0;
  for (const template of templates) {
    const srcDir = path.join(TEMPLATES_DIR, template);
    const destDir = path.join(EXTENSIONS_DIR, template);

    if (fs.existsSync(destDir)) {
      console.log(`  ⏭ ${template} — already exists in extensions/, skipping`);
      continue;
    }

    const count = copyDir(srcDir, destDir);
    totalFiles += count;
    console.log(`  ✓ ${template} — ${count} files copied`);
  }

  console.log(`\n[functions] Setup complete! ${totalFiles} files copied to extensions/\n`);

  // 5. Print next steps
  console.log("Next steps:");
  console.log("  1. Install Rust WASM target (if not already):");
  console.log("     rustup target add wasm32-wasi");
  console.log("     cargo install cargo-wasi");
  console.log("");
  console.log("  2. Deploy Functions to Shopify:");
  console.log("     npx shopify app deploy");
  console.log("");
  console.log("  3. After deploy, Function GIDs are auto-registered in the database.");
  console.log("     You can verify with: SELECT * FROM shop_functions;");
  console.log("");
  console.log("  4. Create discounts using the Rule Engine — Function IDs are resolved automatically.");

  // 6. Check prerequisites
  console.log("\nPrerequisites check:");
  try {
    const { execFileSync } = await import("node:child_process");
    try {
      execFileSync("rustc", ["--version"], { stdio: "pipe" });
      console.log("  ✓ Rust toolchain found");
    } catch {
      console.log("  ✗ Rust not found — install: https://rustup.rs");
    }
    try {
      execFileSync("cargo", ["wasi", "--version"], { stdio: "pipe" });
      console.log("  ✓ cargo-wasi found");
    } catch {
      console.log("  ✗ cargo-wasi not found — install: cargo install cargo-wasi");
    }
  } catch {
    // child_process import failed, skip check
  }
}

main().catch((e) => {
  console.error("[functions] Failed:", e);
  process.exit(1);
});
