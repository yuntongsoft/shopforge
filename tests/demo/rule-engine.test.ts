/**
 * Tests for demo/services/rule-engine.ts — discount rule to config conversion
 *
 * ============================================================================
 * DEMO CODE — Delete tests/demo/ and app/demo/ to remove all demo code
 * ============================================================================
 */
import { describe, it, expect, vi } from "vitest";

// Mock dependencies
vi.mock("~/demo/services/function-registry", () => ({
  functionRegistry: {
    getFunctionId: vi.fn().mockResolvedValue("gid://shopify/Function/test-123"),
  },
}));

vi.mock("~/demo/services/discount-api", () => ({
  discountApi: vi.fn().mockReturnValue({
    createDiscount: vi.fn().mockResolvedValue({
      discount: { id: "gid://shopify/DiscountAutomaticApp/test", title: "Test", status: "active" },
    }),
    updateDiscountConfig: vi.fn().mockResolvedValue({ success: true }),
    deleteDiscount: vi.fn().mockResolvedValue({ success: true }),
  }),
}));

import { ruleEngine } from "~/demo/services/rule-engine";

describe("ruleEngine", () => {
  const engine = ruleEngine("test-shop.myshopify.com", "test-token", "test-shop-id");

  describe("createDiscount", () => {
    it("should create an order-discount with business parameters", async () => {
      const result = await engine.createDiscount({
        type: "order-discount",
        title: "10% off $50+",
        rule: { minSubtotal: 50, discountPercent: 10 },
      });

      expect(result.discount).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    it("should create a free-shipping discount", async () => {
      const result = await engine.createDiscount({
        type: "free-shipping",
        title: "Free shipping over $100",
        rule: { minSubtotal: 100, message: "You qualify for free shipping!" },
      });

      expect(result.discount).toBeDefined();
    });

    it("should create a volume-discount with tiers", async () => {
      const result = await engine.createDiscount({
        type: "volume-discount",
        title: "Buy more save more",
        rule: {
          tiers: [
            { minQty: 5, percent: 5 },
            { minQty: 10, percent: 10 },
            { minQty: 20, percent: 15 },
          ],
        },
      });

      expect(result.discount).toBeDefined();
    });

    it("should create a BOGO discount", async () => {
      const result = await engine.createDiscount({
        type: "bogo",
        title: "Buy 2 Get 1 Free",
        rule: { buyQty: 2, getQty: 1 },
      });

      expect(result.discount).toBeDefined();
    });
  });

  describe("updateDiscount", () => {
    it("should update an existing discount's config", async () => {
      const result = await engine.updateDiscount("discount-123", "order-discount", {
        minSubtotal: 75,
        discountPercent: 15,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("deleteDiscount", () => {
    it("should deactivate a discount", async () => {
      const result = await engine.deleteDiscount("discount-123");
      expect(result.success).toBe(true);
    });
  });
});
