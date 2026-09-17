/**
 * File: scripts/_internal/test-function.ts
 * Purpose: INTERNAL — Local Function test runner
 *
 * Usage (internal only):
 *   npx tsx scripts/_internal/test-function.ts
 *   npx tsx scripts/_internal/test-function.ts --input custom.json
 *
 * What it does:
 *   1. Reads the test input JSON
 *   2. Runs the JS Function logic against it
 *   3. Prints the discount result in a readable format
 *
 * This eliminates the need for `shopify app function run` during development.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// Parse args
const args = process.argv.slice(2);
const inputIdx = args.indexOf("--input");
const inputPath = inputIdx >= 0 ? args[inputIdx + 1] : null;
const funcIdx = args.indexOf("--function");
const funcName = funcIdx >= 0 ? args[funcIdx + 1] : "order-discount-js";

// Resolve paths
const extensionDir = path.join(ROOT, "extensions", funcName);
const runJsPath = path.join(extensionDir, "src", "run.js");
const testInputPath = inputPath
  ? path.resolve(inputPath)
  : path.join(extensionDir, "test-input.json");

console.log("╔══════════════════════════════════════════════╗");
console.log("║   ShopForge — Local Function Test Runner     ║");
console.log("╚══════════════════════════════════════════════╝\n");

// Check files exist
if (!fs.existsSync(runJsPath)) {
  console.error(`Function not found: ${runJsPath}`);
  console.error(`Available: ${fs.readdirSync(path.join(ROOT, "extensions")).join(", ")}`);
  process.exit(1);
}

if (!fs.existsSync(testInputPath)) {
  console.error(`Test input not found: ${testInputPath}`);
  process.exit(1);
}

// Read input
const input = JSON.parse(fs.readFileSync(testInputPath, "utf-8"));
console.log(`Function: ${funcName}`);
console.log(`Input:    ${testInputPath}`);
console.log("");

// Pretty-print input summary
const lines = input.cart?.lines || [];
const subtotal = input.cart?.cost?.subtotalAmount?.amount || "0";
const config = input.discount?.metafield?.value;
console.log(`Cart: ${lines.length} line(s), subtotal: $${subtotal}`);
if (config) {
  try {
    const cfg = JSON.parse(config);
    console.log(`Config: min $${cfg.minSubtotal} → ${cfg.discountPercent}% off`);
  } catch {
    console.log(`Config: ${config}`);
  }
}
console.log("");

// Import and run the Function
try {
  // Dynamic import of the run.js module (convert to file:// URL for Windows)
  const module = await import(pathToFileURL(runJsPath).href);
  const runFn = module.run;

  if (typeof runFn !== "function") {
    console.error("No 'run' function exported from the Function file.");
    process.exit(1);
  }

  // Execute
  const startTime = performance.now();
  const result = runFn(input);
  const elapsed = (performance.now() - startTime).toFixed(2);

  // Print result
  console.log("─".repeat(50));
  console.log(`Result (${elapsed}ms):`);
  console.log("─".repeat(50));

  if (!result.discounts || result.discounts.length === 0) {
    console.log("  No discount applied.");
  } else {
    for (const discount of result.discounts) {
      console.log(`  Message: ${discount.message || "(none)"}`);
      console.log(`  Targets: ${discount.targets?.length || 0} line(s)`);
      if (discount.value?.percentage) {
        console.log(`  Value:   ${discount.value.percentage.value}% off`);
      } else if (discount.value?.fixedAmount) {
        console.log(`  Value:   $${discount.value.fixedAmount.amount} off`);
      }
    }
  }

  console.log(`  Strategy: ${result.discountApplicationStrategy || "FIRST"}`);
  console.log("");

  // Performance check
  const elapsedNum = parseFloat(elapsed);
  if (elapsedNum > 50) {
    console.log(`  ⚠ WARNING: Execution took ${elapsed}ms (Shopify limit: 50ms)`);
  } else {
    console.log(`  ✓ Performance OK (${elapsed}ms < 50ms limit)`);
  }
} catch (error) {
  console.error(`\n✗ Function execution failed:`);
  console.error(`  ${(error as Error).message}`);
  if ((error as Error).stack) {
    console.error(`  ${(error as Error).stack?.split("\n").slice(1, 4).join("\n")}`);
  }
  process.exit(1);
}
