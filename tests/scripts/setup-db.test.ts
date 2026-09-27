import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

let root: string;
const schema = 'datasource db {\n provider = "sqlite"\n url = env("DATABASE_URL")\n}\nmodel CustomWidget {\n id String @id\n}\n';

beforeEach(async () => {
  await mkdir("node_modules/.cache", { recursive: true });
  root = await mkdtemp(path.resolve("node_modules/.cache/setup-test-"));
  await mkdir(path.join(root, "scripts"));
  await mkdir(path.join(root, "prisma"));
  // Copy setup.ts and its lib dependency
  await copyFile("scripts/setup.ts", path.join(root, "scripts/setup.ts"));
  await writeFile(path.join(root, "prisma/schema.prisma"), schema);
}, 15_000);

afterEach(() => rm(root, { recursive: true, force: true }));

function run(args: string[] = [], env: Record<string, string> = {}) {
  const childEnv = { ...process.env };
  for (const key of ["DATABASE_URL", "ENCRYPTION_KEY", "CSRF_SECRET", "SESSION_SECRET"]) delete childEnv[key];
  return spawnSync("npx", ["tsx", "scripts/setup.ts", ...args], {
    cwd: root,
    env: { ...childEnv, ...env },
    encoding: "utf8",
    timeout: 30_000,
    shell: process.platform === "win32",
  });
}

describe("Setup: Installation initialization", () => {
  it("CI mode with DATABASE_URL is a no-op", async () => {
    const result = run([], { DATABASE_URL: "postgresql://localhost:1/not-accessed", CI: "true" });
    expect(result.status).toBe(0);
    await expect(access(path.join(root, ".env"))).rejects.toThrow();
    expect(await readFile(path.join(root, "prisma/schema.prisma"), "utf8")).toBe(schema);
  });

  it("--provider flag updates schema and generates .env with secrets", async () => {
    const result = run(["--provider", "sqlite"]);
    expect(result.status).toBe(0);

    const schemaContent = await readFile(path.join(root, "prisma/schema.prisma"), "utf8");
    expect(schemaContent).toContain('provider = "sqlite"');
    expect(schemaContent).toContain("model CustomWidget");

    const envContent = await readFile(path.join(root, ".env"), "utf8");
    expect(envContent).toMatch(/ENCRYPTION_KEY=[a-f0-9]{64}/);
    expect(envContent).toMatch(/CSRF_SECRET=[a-f0-9]{64}/);
    expect(envContent).toContain("DATABASE_URL=file:./dev.db");
  });

  it.each(["postgresql", "mysql", "sqlite"])("--provider %s preserves custom models", async (provider) => {
    const result = run(["--provider", provider]);
    expect(result.status).toBe(0);

    const schemaContent = await readFile(path.join(root, "prisma/schema.prisma"), "utf8");
    expect(schemaContent).toContain(`provider = "${provider}"`);
    expect(schemaContent).toContain("model CustomWidget");

    const envContent = await readFile(path.join(root, ".env"), "utf8");
    expect(envContent).toMatch(/ENCRYPTION_KEY=[a-f0-9]{64}/);
    expect(envContent).toMatch(/CSRF_SECRET=[a-f0-9]{64}/);
    // Setup should NOT create the actual database file
    await expect(access(path.join(root, "prisma/dev.db"))).rejects.toThrow();
  });

  it("unknown arguments are rejected", async () => {
    const result = run(["--unknown"]);
    expect(result.status).toBe(1);
  });

  it("existing .env with Shopify credentials is preserved", async () => {
    const content = "SHOPIFY_API_KEY=test123\nSHOPIFY_API_SECRET=secret456\nDATABASE_URL=file:./dev.db\nENCRYPTION_KEY=abc\n";
    await writeFile(path.join(root, ".env"), content);

    const result = run([]);
    expect(result.status).toBe(0);

    // .env should not be overwritten
    expect(await readFile(path.join(root, ".env"), "utf8")).toBe(content);
  });

  it("dev.ts auto-runs prisma db push but does not write secrets or accept-data-loss", async () => {
    const dev = await readFile("scripts/dev.ts", "utf8");
    // dev.ts should auto-run db push
    expect(dev).toMatch(/prisma.*db.*push/);
    // But should NOT use --accept-data-loss or generate secrets
    expect(dev).not.toMatch(/accept-data-loss/);
    expect(dev).not.toMatch(/randomBytes/);
  });

  it("postinstall is removed to avoid generating Prisma Client before .env exists", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    // postinstall was removed — it ran prisma generate before .env existed,
    // causing Client to be generated with wrong provider (sqlite default)
    expect(pkg.scripts.postinstall).toBeUndefined();
  });

  it("dev.ts regenerates Prisma Client when schema changes (hash-based)", async () => {
    const dev = await readFile("scripts/dev.ts", "utf8");
    // dev.ts should use hash-based detection for schema changes
    expect(dev).toMatch(/createHash/);
    expect(dev).toMatch(/prisma.*generate/);
    expect(dev).toMatch(/schema-hash/);
  });
});
