/**
 * File: scripts/_internal/generate-function.ts
 * Purpose: INTERNAL TOOL — Function scaffolding (not exposed to developers)
 *
 * This is an internal framework tool. Developers should NOT need to run this
 * directly. Functions are managed automatically by the build system.
 *
 * Usage (internal only):
 *   npx tsx scripts/_internal/generate-function.ts order-discount
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const templateName = args[0];
const useJs = args.includes("--js");

// Templates live in templates/ directory, generated Functions go to extensions/
const TEMPLATES: Record<string, { dir: string; label: string }> = {
  "order-discount": { dir: "order-discount-rust", label: "Order Discount (Rust)" },
  "hello-function": { dir: "hello-function-rust", label: "Hello Function (Rust)" },
};

if (!templateName) {
  console.log("ShopForge Function Generator (Internal)");
  console.log("");
  console.log("Usage:");
  console.log("  npx tsx scripts/_internal/generate-function.ts <template> [--js]");
  console.log("");
  console.log("Available templates:");
  for (const [key, val] of Object.entries(TEMPLATES)) {
    console.log(`  ${key.padEnd(22)} — ${val.label}`);
  }
  process.exit(0);
}

// Resolve template
const resolvedTemplate = useJs && templateName === "order-discount" ? "order-discount-js" : templateName;
const template = TEMPLATES[resolvedTemplate];

if (!template) {
  console.error(`Unknown template: ${resolvedTemplate}`);
  console.error(`Available: ${Object.keys(TEMPLATES).join(", ")}`);
  process.exit(1);
}

const templateDir = path.join(ROOT, "templates", template.dir);
if (!fs.existsSync(templateDir)) {
  console.error(`Template directory not found: ${templateDir}`);
  process.exit(1);
}

// Determine output name
const outputName = resolvedTemplate;
const outputDir = path.join(ROOT, "extensions", outputName);

if (fs.existsSync(outputDir)) {
  console.error(`Extension already exists: extensions/${outputName}/`);
  console.error("Use a different name or delete the existing directory.");
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Copy template
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\nGenerating Function: ${outputName}`);
console.log(`Template: ${template.label}\n`);

copyDir(templateDir, outputDir);

// Update references in config files
const tomlFile = path.join(outputDir, "shopify.function.extension.toml");
if (fs.existsSync(tomlFile)) {
  let content = fs.readFileSync(tomlFile, "utf-8");
  content = content.replace(/name = ".*"/, `name = "${outputName}"`);
  fs.writeFileSync(tomlFile, content);
}

// Update Cargo.toml if Rust
const cargoFile = path.join(outputDir, "Cargo.toml");
if (fs.existsSync(cargoFile)) {
  let content = fs.readFileSync(cargoFile, "utf-8");
  content = content.replace(/name = ".*"/, `name = "${outputName.replace(/-/g, "_")}"`);
  fs.writeFileSync(cargoFile, content);
}

console.log(`Created: extensions/${outputName}/`);

// ─────────────────────────────────────────────────────────────────────────────
// Generate config UI route (if not exists)
// ─────────────────────────────────────────────────────────────────────────────

const discountsRoute = path.join(ROOT, "app", "routes", "app.discounts.tsx");
if (!fs.existsSync(discountsRoute)) {
  console.log("Note: app/routes/app.discounts.tsx not found.");
  console.log("      Copy it from the order-discount template or run the full setup.");
} else {
  console.log("Config UI: app/routes/app.discounts.tsx (already exists)");
}

console.log(`\nFunction generated. Run \`npm run dev\` to compile and deploy.`);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function copyDir(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === "target" || entry.name === "node_modules" || entry.name === "dist") continue;
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
