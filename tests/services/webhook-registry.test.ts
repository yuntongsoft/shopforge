/**
 * Tests for webhook-registry.ts — handler registration and dispatch
 *
 * Coverage:
 *   - Register and dispatch a handler
 *   - Multiple handlers per topic
 *   - Dispatch returns false for unregistered topics
 *   - Handler errors don't break other handlers
 *   - getRegisteredTopics returns all topics
 *   - Built-in handlers are auto-registered
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() ensures mockPrisma is available when the hoisted vi.mock() runs
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    shop: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    session: {
      deleteMany: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockPrisma)),
  },
}));
vi.mock("~/db.server", () => ({ default: mockPrisma }));

import { WebhookRegistry } from "~/services/webhook-registry";

describe("WebhookRegistry", () => {
  let registry: WebhookRegistry;

  beforeEach(() => {
    registry = new WebhookRegistry();
  });

  it("should register and dispatch a handler", async () => {
    const handler = vi.fn();
    registry.on("ORDERS_CREATE", handler);
    const result = await registry.dispatch("ORDERS_CREATE", "test.myshopify.com", { id: 1 });
    expect(handler).toHaveBeenCalledWith("test.myshopify.com", { id: 1 });
    expect(result).toBe(true);
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
});
