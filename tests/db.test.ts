import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ construct: vi.fn(), on: vi.fn(), connect: vi.fn(), error: vi.fn(), warn: vi.fn() }));
vi.mock("@prisma/client", () => ({ PrismaClient: class {
  constructor(options: unknown) { mocks.construct(options); }
  $on = mocks.on;
  $connect = mocks.connect;
} }));
vi.mock("~/utils/logger.server", () => ({ createLogger: () => ({ error: mocks.error, warn: mocks.warn }) }));
vi.unmock("~/db.server");
const shared = globalThis as typeof globalThis & { __prisma?: unknown };

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  delete shared.__prisma;
  vi.stubEnv("VERCEL", ""); vi.stubEnv("AWS_LAMBDA", "");
});
afterEach(() => { delete shared.__prisma; vi.unstubAllEnvs(); });

async function config(url: string) {
  vi.stubEnv("DATABASE_URL", url);
  await import("~/db.server");
  return mocks.construct.mock.calls[0][0] as { datasources: { db: { url: string } }; log: unknown[] };
}

describe("Prisma safe initialization", () => {
  it("SQLite URL kept as-is, import does not actively connect", async () => {
    expect((await config("file:./isolated.db")).datasources.db.url).toBe("file:./isolated.db");
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it.each(["postgresql", "postgres", "mysql"])("%s supplements default pool params but keeps explicit params", async (protocol) => {
    const value = await config(`${protocol}://user:pass@localhost:1/test?connect_timeout=7&pool_timeout=5`);
    const parsed = new URL(value.datasources.db.url);
    expect(parsed.searchParams.get("connection_limit")).toBe("10");
    expect(parsed.searchParams.get("pool_timeout")).toBe("5");
    expect(parsed.searchParams.get("connect_timeout")).toBe("7");
  });
  it("Serverless uses single connection, param name in password does not affect detection", async () => {
    vi.stubEnv("VERCEL", "1");
    const value = await config("postgresql://user:connection_limit@localhost:1/test");
    expect(new URL(value.datasources.db.url).searchParams.get("connection_limit")).toBe("1");
  });
  it("Dev hot reload reuses same client", async () => {
    await config("file:./isolated.db");
    vi.resetModules();
    await import("~/db.server");
    expect(mocks.construct).toHaveBeenCalledTimes(1);
  });
  it.each(["production", "development"])("%s does not output Prisma raw SQL or credentials", async (env) => {
    vi.stubEnv("NODE_ENV", env);
    const value = await config("file:./isolated.db");
    expect(value.log).toEqual([{ emit: "event", level: "error" }, { emit: "event", level: "warn" }]);
    for (const [event, listener] of mocks.on.mock.calls) {
      listener({ message: "secret-token customer@example.com", query: "private SQL" });
      expect(mocks[event as "error" | "warn"]).toHaveBeenCalledOnce();
    }
    expect(JSON.stringify([mocks.error.mock.calls, mocks.warn.mock.calls])).not.toMatch(/secret-token|customer@|private SQL/);
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
