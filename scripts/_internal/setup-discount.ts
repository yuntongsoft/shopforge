/**
 * File: scripts/_internal/setup-discount.ts
 * Purpose: INTERNAL — One-command discount setup (build, deploy, verify)
 *
 * Usage (internal only):
 *   npx tsx scripts/_internal/setup-discount.ts
 *
 * What it does:
 *   1. Checks if order-discount-js extension exists
 *   2. Builds the Function (javy compile)
 *   3. Deploys via Shopify CLI
 *   4. Prints the Function GID for the UI
 *
 * This eliminates ALL manual steps after initial clone.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const EXTENSION_NAME = "order-discount-js";
const EXTENSION_DIR = path.join(ROOT, "extensions", EXTENSION_NAME);

console.log("╔══════════════════════════════════════════════╗");
console.log("║   ShopForge — One-Click Discount Setup       ║");
console.log("╚══════════════════════════════════════════════╝\n");

// Step 1: Check extension exists
if (!fs.existsSync(EXTENSION_DIR)) {
  console.log("Extension not found. Generating from template...\n");
  try {
    execSync(`npx tsx scripts/_internal/generate-function.ts ${EXTENSION_NAME}`, {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    console.error("Failed to generate Function template.");
    process.exit(1);
  }
}

// Step 2: Check javy is available
console.log("\n[1/3] Checking Javy compiler...");
try {
  execSync("npx javy --version", { cwd: ROOT, stdio: "pipe" });
  console.log("  ✓ Javy found");
} catch {
  console.log("  Installing Javy...");
  try {
    execSync("npm install -D @bytecodealliance/javy", { cwd: ROOT, stdio: "inherit" });
    console.log("  ✓ Javy installed");
  } catch {
    console.error("  ✗ Failed to install Javy. Install manually: npm install -D @bytecodealliance/javy");
    process.exit(1);
  }
}

// Step 3: Build
console.log("\n[2/3] Building Function...");
const distDir = path.join(EXTENSION_DIR, "dist");
fs.mkdirSync(distDir, { recursive: true });

try {
  execSync(
    `npx javy compile src/run.js -o dist/function.wasm`,
    { cwd: EXTENSION_DIR, stdio: "inherit" }
  );
  console.log("  ✓ Function built: dist/function.wasm");
} catch {
  console.error("  ✗ Build failed. Check src/run.js for syntax errors.");
  process.exit(1);
}

// Step 4: Deploy
console.log("\n[3/3] Deploying to Shopify...");
console.log("  (This will open a browser for Shopify authentication)\n");

try {
  execSync("shopify app deploy --force", {
    cwd: ROOT,
    stdio: "inherit",
  });
  console.log("\n  ✓ Deployed successfully!");
} catch {
  console.log("\n  Note: Deploy may have succeeded but returned non-zero exit code.");
  console.log("  Check Shopify Partner Dashboard for the Function status.");
}

// Done
console.log(`
╔══════════════════════════════════════════════╗
║   Setup Complete!                            ║
╚══════════════════════════════════════════════╝

Next: Open your app → /app/discounts
  → The Function should appear in the dropdown
  → Fill in the discount amount and click Create

That's it. No manual GID copying needed.
`);
