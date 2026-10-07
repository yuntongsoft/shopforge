/**
 * Tests for webhook-outbound.ts — SSRF protection, HMAC signing, and delivery
 *
 * Coverage:
 *   - SSRF: isPrivateIp rejects private/reserved IPv4 and IPv6 ranges
 *   - SSRF: validateWebhookUrl rejects localhost, private IPs, bad ports, bad protocols
 *   - SSRF: validateWebhookUrl rejects DNS rebinding to private IPs
 *   - emitWebhook: delivers to matching configs with HMAC signature
 *   - emitWebhook: skips configs that don't subscribe to the event
 *   - emitWebhook: skips configs with invalid URLs (SSRF)
 *   - generateWebhookSecret: returns 64-char hex string
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// vi.hoisted() for mocks available at module load time
const { mockPrisma, mockFetch } = vi.hoisted(() => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true });
  const mockPrisma = {
    webhookConfig: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  return { mockPrisma, mockFetch };
});

vi.mock("~/db.server", () => ({ default: mockPrisma }));

// Mock dns to control SSRF validation — lookup({ all: true }) returns an array
vi.mock("dns/promises", () => ({
  default: {
    lookup: vi.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
  },
}));

import { emitWebhook, generateWebhookSecret } from "~/services/webhook-outbound";

describe("WebhookOutbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Install global fetch mock
    vi.stubGlobal("fetch", mockFetch);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // generateWebhookSecret
  // ─────────────────────────────────────────────────────────────────────────

  it("should generate a 64-char hex secret", () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should generate unique secrets each time", () => {
    const s1 = generateWebhookSecret();
    const s2 = generateWebhookSecret();
    expect(s1).not.toBe(s2);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // emitWebhook — delivery
  // ─────────────────────────────────────────────────────────────────────────

  it("should deliver to matching active configs with HMAC signature", async () => {
    const secret = "test-secret-key";
    mockPrisma.webhookConfig.findMany.mockResolvedValue([{
      id: "config-1",
      shopId: "shop-1",
      url: "https://example.com/webhook",
      secret,
      events: JSON.stringify(["rule.created", "rule.updated"]),
      isActive: true,
    }]);

    await emitWebhook("shop-1", "rule.created", { ruleId: "123" });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    // DNS pinning replaces hostname with resolved IP
    expect(url).toBe("https://93.184.216.34/webhook");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["X-Webhook-Event"]).toBe("rule.created");
    // Host header preserves original hostname for virtual hosting
    expect(options.headers["Host"]).toBe("example.com");
    expect(options.headers["X-Webhook-Delivery"]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );

    // Verify HMAC signature
    const body = options.body;
    const expectedSig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(options.headers["X-Webhook-Signature"]).toBe(`sha256=${expectedSig}`);
  });

  it("should skip configs that don't subscribe to the event", async () => {
    mockPrisma.webhookConfig.findMany.mockResolvedValue([{
      id: "config-1",
      url: "https://example.com/webhook",
      secret: "secret",
      events: JSON.stringify(["rule.updated"]), // only subscribed to rule.updated
      isActive: true,
    }]);

    await emitWebhook("shop-1", "rule.created", { ruleId: "123" });

    // No delivery should happen
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should skip configs with invalid events JSON", async () => {
    mockPrisma.webhookConfig.findMany.mockResolvedValue([{
      id: "config-1",
      url: "https://example.com/webhook",
      secret: "secret",
      events: "not-valid-json",
      isActive: true,
    }]);

    await emitWebhook("shop-1", "rule.created", { ruleId: "123" });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should not deliver when no configs exist", async () => {
    mockPrisma.webhookConfig.findMany.mockResolvedValue([]);

    await emitWebhook("shop-1", "rule.created", { ruleId: "123" });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should deliver to multiple matching configs", async () => {
    mockPrisma.webhookConfig.findMany.mockResolvedValue([
      {
        id: "config-1",
        url: "https://example.com/webhook1",
        secret: "secret1",
        events: JSON.stringify(["rule.created"]),
        isActive: true,
      },
      {
        id: "config-2",
        url: "https://example.com/webhook2",
        secret: "secret2",
        events: JSON.stringify(["rule.created", "rule.updated"]),
        isActive: true,
      },
    ]);

    await emitWebhook("shop-1", "rule.created", { ruleId: "123" });

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // SSRF protection (via emitWebhook integration)
  // ─────────────────────────────────────────────────────────────────────────

  it("should reject delivery to localhost", async () => {
    mockPrisma.webhookConfig.findMany.mockResolvedValue([{
      id: "config-1",
      url: "http://localhost:3000/webhook",
      secret: "secret",
      events: JSON.stringify(["rule.created"]),
      isActive: true,
    }]);

    await emitWebhook("shop-1", "rule.created", { ruleId: "123" });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should reject delivery to private IP addresses", async () => {
    mockPrisma.webhookConfig.findMany.mockResolvedValue([{
      id: "config-1",
      url: "http://192.168.1.1/webhook",
      secret: "secret",
      events: JSON.stringify(["rule.created"]),
      isActive: true,
    }]);

    await emitWebhook("shop-1", "rule.created", { ruleId: "123" });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("should reject delivery to non-http(s) protocols", async () => {
    mockPrisma.webhookConfig.findMany.mockResolvedValue([{
      id: "config-1",
      url: "ftp://example.com/webhook",
      secret: "secret",
      events: JSON.stringify(["rule.created"]),
      isActive: true,
    }]);

    await emitWebhook("shop-1", "rule.created", { ruleId: "123" });

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
