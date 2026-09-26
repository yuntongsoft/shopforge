import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

let root: string;
const schema = 'datasource db {\n provider = "postgresql"\n url = env("DATABASE_URL")\n}\nmodel CustomWidget {\n id String @id\n}\n';
beforeEach(async () => {
  await mkdir("node_modules/.cache", { recursive: true });
  root = await mkdtemp(path.resolve("node_modules/.cache/setup-test-"));
  await mkdir(path.join(root, "scripts")); await mkdir(path.join(root, "prisma"));
  await copyFile("scripts/setup-db.cjs", path.join(root, "scripts/setup-db.cjs"));
  await writeFile(path.join(root, "prisma/schema.prisma"), schema);
});
afterEach(() => rm(root, { recursive: true, force: true }));
function run(args: string[] = [], env: Record<string, string> = {}) {
  const childEnv = { ...process.env };
  for (const key of ["DATABASE_URL", "ENCRYPTION_KEY", "CSRF_SECRET", "SESSION_SECRET"]) delete childEnv[key];
  return spawnSync(process.execPath, [path.join(root, "scripts/setup-db.cjs"), ...args], { cwd: root, env: { ...childEnv, ...env }, encoding: "utf8" });
}
describe("Installation initialization responsibility isolation", () => {
  it("CI injects database URL without creating .env or overwriting business models", async () => {
    expect(run([], { DATABASE_URL: "postgresql://localhost:1/not-accessed", CI: "true" }).status).toBe(0);
    await expect(access(path.join(root, ".env"))).rejects.toThrow();
    expect(await readFile(path.join(root, "prisma/schema.prisma"), "utf8")).toBe(schema);
  });
  it("Missing config in non-interactive/production does not auto-select SQLite", async () => {
    expect(run([], { NODE_ENV: "production", CI: "true" }).status).toBe(1);
    expect(await readFile(path.join(root, "prisma/schema.prisma"), "utf8")).toBe(schema);
    await expect(access(path.join(root, ".env"))).rejects.toThrow();
  });
  it("Preserves existing .env, prioritizes injected vars, and does not output credentials", async () => {
    const content = 'DATABASE_URL="file:./old.db"\nENCRYPTION_KEY=keep-existing-secret\n';
    await writeFile(path.join(root, ".env"), content);
    const result = run([], { DATABASE_URL: "postgresql://private:secret@localhost:1/not-accessed" });
    expect(result.status).toBe(0);
    expect(result.stdout + result.stderr).not.toMatch(/private|secret|keep-existing/);
    expect(await readFile(path.join(root, ".env"), "utf8")).toBe(content);
  });
  it.each(["postgresql", "mysql", "sqlite"])("Explicit init with %s preserves custom models without connecting to database", async (provider) => {
    expect(run(["--provider", provider]).status).toBe(0);
    const result = await readFile(path.join(root, "prisma/schema.prisma"), "utf8");
    expect(result).toContain(`provider = "${provider}"`);
    expect(result).toContain("model CustomWidget");
    const env = await readFile(path.join(root, ".env"), "utf8");
    expect(env).toMatch(/ENCRYPTION_KEY=[a-f0-9]{64}/);
    expect(env).toMatch(/CSRF_SECRET=[a-f0-9]{64}/);
    await expect(access(path.join(root, "prisma/dev.db"))).rejects.toThrow();
  });
  it("Provider conflicts and unknown arguments are rejected", async () => {
    expect(run(["--provider", "sqlite"], { DATABASE_URL: "postgresql://localhost/test" }).status).toBe(1);
    expect(run(["--unknown"]).status).toBe(1);
    expect(await readFile(path.join(root, "prisma/schema.prisma"), "utf8")).toBe(schema);
  });
  it("postinstall and dev do not perform database writes or auto-generate keys", async () => {
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    expect(pkg.scripts.postinstall).toBe("prisma generate");
    const dev = await readFile("scripts/dev.ts", "utf8");
    expect(dev).not.toMatch(/accept-data-loss|prisma db push|randomBytes|writeFileSync/);
  });
});
