/**
 * Tests for demo/services/function-registry.ts — Function ID resolution and registration
 *
 * ============================================================================
 * DEMO CODE — Delete tests/demo/ and app/demo/ to remove all demo code
 * ============================================================================
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    shopFunction: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("~/db.server", () => ({ default: mockPrisma }));

import { functionRegistry } from "~/demo/services/function-registry";

describe("functionRegistry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    functionRegistry.clearCache();
  });

  describe("getFunctionId", () => {
    it("should read from environment variable first", async () => {
      process.env.FUNCTION_ID_ORDER_DISCOUNT = "gid://shopify/Function/env-123";

      const id = await functionRegistry.getFunctionId("shop-1", "order-discount");
      expect(id).toBe("gid://shopify/Function/env-123");
      expect(mockPrisma.shopFunction.findFirst).not.toHaveBeenCalled();

      delete process.env.FUNCTION_ID_ORDER_DISCOUNT;
    });

    it("should fall back to database when env var is not set", async () => {
      mockPrisma.shopFunction.findFirst.mockResolvedValue({
        functionId: "gid://shopify/Function/db-456",
      });

      const id = await functionRegistry.getFunctionId("shop-1", "order-discount");
      expect(id).toBe("gid://shopify/Function/db-456");
      expect(mockPrisma.shopFunction.findFirst).toHaveBeenCalledWith({
        where: { shopId: "shop-1", ruleType: "order-discount" },
        select: { functionId: true },
      });
    });

    it("should throw when no Function is registered anywhere", async () => {
      mockPrisma.shopFunction.findFirst.mockResolvedValue(null);

      await expect(
        functionRegistry.getFunctionId("shop-1", "bogo")
      ).rejects.toThrow('No Function registered for rule type "bogo"');
    });

    it("should use cache on second call (no DB query)", async () => {
      process.env.FUNCTION_ID_FREE_SHIPPING = "gid://shopify/Function/cached";

      await functionRegistry.getFunctionId("shop-1", "free-shipping");
      const id = await functionRegistry.getFunctionId("shop-1", "free-shipping");
      expect(id).toBe("gid://shopify/Function/cached");

      delete process.env.FUNCTION_ID_FREE_SHIPPING;
    });
  });

  describe("register", () => {
    it("should persist to database via upsert", async () => {
      mockPrisma.shopFunction.upsert.mockResolvedValue({});

      await functionRegistry.register("shop-1", "order-discount", "gid://shopify/Function/abc", "Order Discount");

      expect(mockPrisma.shopFunction.upsert).toHaveBeenCalledWith({
        where: { shopId_ruleType: { shopId: "shop-1", ruleType: "order-discount" } },
        create: { shopId: "shop-1", ruleType: "order-discount", functionId: "gid://shopify/Function/abc", label: "Order Discount" },
        update: { functionId: "gid://shopify/Function/abc", label: "Order Discount" },
      });
    });

    it("should update cache so subsequent reads skip DB", async () => {
      mockPrisma.shopFunction.upsert.mockResolvedValue({});

      await functionRegistry.register("shop-1", "bogo", "gid://shopify/Function/bogo-1");

      const id = await functionRegistry.getFunctionId("shop-1", "bogo");
      expect(id).toBe("gid://shopify/Function/bogo-1");
      expect(mockPrisma.shopFunction.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("listMappings", () => {
    it("should return all mappings for a shop", async () => {
      mockPrisma.shopFunction.findMany.mockResolvedValue([
        { ruleType: "order-discount", functionId: "gid://f1", label: "Order Discount" },
        { ruleType: "bogo", functionId: "gid://f2", label: "BOGO" },
      ]);

      const mappings = await functionRegistry.listMappings("shop-1");
      expect(mappings).toHaveLength(2);
      expect(mappings[0].ruleType).toBe("order-discount");
      expect(mappings[1].ruleType).toBe("bogo");
    });

    it("should return empty array when no mappings exist", async () => {
      mockPrisma.shopFunction.findMany.mockResolvedValue([]);

      const mappings = await functionRegistry.listMappings("shop-1");
      expect(mappings).toHaveLength(0);
    });
  });

  describe("clearCache", () => {
    it("should force re-read from source on next getFunctionId call", async () => {
      process.env.FUNCTION_ID_VOLUME_DISCOUNT = "gid://v1";
      await functionRegistry.getFunctionId("shop-1", "volume-discount");

      process.env.FUNCTION_ID_VOLUME_DISCOUNT = "gid://v2";
      const cached = await functionRegistry.getFunctionId("shop-1", "volume-discount");
      expect(cached).toBe("gid://v1");

      functionRegistry.clearCache();
      const fresh = await functionRegistry.getFunctionId("shop-1", "volume-discount");
      expect(fresh).toBe("gid://v2");

      delete process.env.FUNCTION_ID_VOLUME_DISCOUNT;
    });
  });
});
