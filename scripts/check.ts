/**
 * File: scripts/check.ts
 * Purpose: Cross-platform type check + test runner.
 *
 * Usage: npm run check
 *
 * Replaces `tsc --noEmit && vitest run` which fails in PowerShell.
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

let failed = false;

console.log("\n━━━ Type Check ━━━");
try {
  execSync("npx tsc --noEmit", { cwd: ROOT, stdio: "inherit" });
  console.log("  ✓ No type errors\n");
} catch {
  console.log("  ✗ Type errors found\n");
  failed = true;
}

console.log("━━━ Tests ━━━");
try {
  execSync("npx vitest run", { cwd: ROOT, stdio: "inherit" });
  console.log("  ✓ All tests passed\n");
} catch {
  console.log("  ✗ Some tests failed\n");
  failed = true;
}

if (failed) {
  process.exit(1);
}

console.log("━━━ All checks passed! ━━━\n");
