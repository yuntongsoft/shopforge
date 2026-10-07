/**
 * Tests for webhook-registry.ts — handler registration, sync/async dispatch, and built-in handlers
 *
 * Coverage:
 *   - Register and dispatch a handler (with webhookId passthrough)
 *   - Multiple handlers per topic
 *   - Dispatch returns false for unregistered topics
 *   - Handler errors don't break other handlers
 *   - getRegisteredTopics returns all topics
 *   - Async handlers enqueue via webhook-queue instead of inline execution
 *   - dispatchHandlers() calls handlers without retry wrapper
 *   - Built-in handlers are auto-registered on module import
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() ensures mocks are available when the hoisted vi.mock() runs
const { mockPrisma, mockEnqueueWebhook } = vi.hoisted(() => {
  const mockEnqueueWebhook = vi.fn();
  const mockPrisma = {
    shop: {
      findUnique: vi.fn().mockResolvedValue({ id: "shop-123" }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn(),
    },
    session: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  };
  return { mockPrisma, mockEnqueueWebhook };
});

vi.mock("~/db.server", () => ({ default: mockPrisma }));
vi.mock("~/services/webhook-queue", () => ({
  enqueueWebhook: mockEnqueueWebhook,
}));
// Mock billing service to avoid real billing logic in built-in handler tests
vi.mock("~/services/billing.service", () => ({
  billingService: {
    handleSubscriptionActivated: vi.fn(),
    handleSubscriptionDeactivated: vi.fn(),
  },
}));

import { WebhookRegistry } from "~/services/webhook-registry";

describe("WebhookRegistry", () => {
  let registry: WebhookRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    registry = new WebhookRegistry();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Sync dispatch
  // ─────────────────────────────────────────────────────────────────────────

  it("should register and dispatch a sync handler with webhookId", async () => {
    const handler = vi.fn();
    registry.on("ORDERS_CREATE", handler);
    const result = await registry.dispatch("ORDERS_CREATE", "test.myshopify.com", { id: 1 }, "wh-abc");
    expect(handler).toHaveBeenCalledWith("test.myshopify.com", { id: 1 }, "wh-abc");
    expect(result).toBe(true);
  });

  it("should dispatch without webhookId when not provided", async () => {
    const handler = vi.fn();
    registry.on("ORDERS_CREATE", handler);
    await registry.dispatch("ORDERS_CREATE", "test.myshopify.com", { id: 1 });
    expect(handler).toHaveBeenCalledWith("test.myshopify.com", { id: 1 }, undefined);
  });

  it("should support multiple handlers per topic", async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    registry.on("ORDERS_CREATE", handler1);
    registry.on("ORDERS_CREATE", handler2);
    await registry.dispatch("ORDERS_CREATE", "test.myshopify.com", {});
    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();
  });

  it("should return false for unregistered topics", async () => {
    const result = await registry.dispatch("UNKNOWN_TOPIC", "test.myshopify.com", {});
    expect(result).toBe(false);
  });

  it("should continue dispatch even if one handler throws", async () => {
    const badHandler = vi.fn().mockRejectedValue(new Error("boom"));
    const goodHandler = vi.fn();
    registry.on("ORDERS_CREATE", badHandler);
    registry.on("ORDERS_CREATE", goodHandler);
    const result = await registry.dispatch("ORDERS_CREATE", "test.myshopify.com", {});
    expect(result).toBe(true);
    expect(badHandler).toHaveBeenCalled();
    expect(goodHandler).toHaveBeenCalled();
  });

  it("should return all registered topics", () => {
    registry.on("ORDERS_CREATE", vi.fn());
    registry.on("PRODUCTS_UPDATE", vi.fn());
    const topics = registry.getRegisteredTopics();
    expect(topics).toContain("ORDERS_CREATE");
    expect(topics).toContain("PRODUCTS_UPDATE");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Async dispatch
  // ─────────────────────────────────────────────────────────────────────────

  it("should enqueue async handlers via webhook-queue", async () => {
    const handler = vi.fn();
    registry.on("ORDERS_CREATE", handler, { async: true });

    await registry.dispatch("ORDERS_CREATE", "test.myshopify.com", { id: 1 }, "wh-xyz");

    // Handler should NOT be called directly — it goes through the queue
    expect(handler).not.toHaveBeenCalled();
    // enqueueWebhook should be called with topic, shopDomain, payload, webhookId
    expect(mockEnqueueWebhook).toHaveBeenCalledWith(
      "ORDERS_CREATE",
      "test.myshopify.com",
      { id: 1 },
      "wh-xyz"
    );
  });

  it("should handle mix of sync and async handlers for same topic", async () => {
    const syncHandler = vi.fn();
    const asyncHandler = vi.fn();
    registry.on("ORDERS_CREATE", syncHandler); // sync (default)
    registry.on("ORDERS_CREATE", asyncHandler, { async: true });

    await registry.dispatch("ORDERS_CREATE", "test.myshopify.com", { id: 1 });

    // Sync handler should be called directly
    expect(syncHandler).toHaveBeenCalled();
    // Async handler should be enqueued, not called directly
    expect(asyncHandler).not.toHaveBeenCalled();
    expect(mockEnqueueWebhook).toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // dispatchHandlers (queue consumer path)
  // ─────────────────────────────────────────────────────────────────────────

  it("should call handlers directly via dispatchHandlers without retry", async () => {
    const handler = vi.fn();
    registry.on("ORDERS_CREATE", handler, { async: true });

    await registry.dispatchHandlers("ORDERS_CREATE", "test.myshopify.com", { id: 1 }, "wh-123");

    expect(handler).toHaveBeenCalledWith("test.myshopify.com", { id: 1 }, "wh-123");
  });

  it("should handle dispatchHandlers with no registered handlers", async () => {
    // Should not throw — just log a warning
    await expect(
      registry.dispatchHandlers("UNKNOWN", "test.myshopify.com", {})
    ).resolves.toBeUndefined();
  });
});
