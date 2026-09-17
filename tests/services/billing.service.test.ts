/**
 * Tests for billing.service.ts — plan management and subscription lifecycle
 *
 * Coverage:
 *   - BILLING_PLANS has correct structure
 *   - getShopPlan returns shop's plan or defaults to "free"
 *   - createSubscription rejects free plan
 *   - handleSubscriptionActivated updates plan
 *   - handleSubscriptionDeactivated downgrades to free
 *   - Unknown plan name is handled gracefully
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() ensures mocks are available when the hoisted vi.mock() runs
const { mockPrisma, mockGraphql } = vi.hoisted(() => ({
  mockPrisma: {
    shop: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  mockGraphql: vi.fn(),
}));
vi.mock("~/db.server", () => ({ default: mockPrisma }));
vi.mock("~/services/shopify", () => ({
  shopifyAdmin: () => ({ graphql: mockGraphql }),
}));

import { billingService, BILLING_PLANS, type PlanName } from "~/services/billing.service";

describe("BILLING_PLANS", () => {
  it("should have free, pro, and business plans", () => {
    expect(Object.keys(BILLING_PLANS)).toEqual(["free", "pro", "business"]);
  });

  it("should have free plan with price 0", () => {
    expect(BILLING_PLANS.free.price).toBe(0);
  });

  it("should have pro plan with price > 0", () => {
    expect(BILLING_PLANS.pro.price).toBeGreaterThan(0);
  });

  it("should have trial days on paid plans", () => {
    expect(BILLING_PLANS.pro.trialDays).toBeGreaterThan(0);
    expect(BILLING_PLANS.business.trialDays).toBeGreaterThan(0);
  });
});

describe("getShopPlan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should return shop's current plan", async () => {
    mockPrisma.shop.findUnique.mockResolvedValue({ plan: "pro" });
    const plan = await billingService.getShopPlan("shop-1");
    expect(plan).toBe("pro");
  });

  it("should default to 'free' when shop not found", async () => {
    mockPrisma.shop.findUnique.mockResolvedValue(null);
    const plan = await billingService.getShopPlan("nonexistent");
    expect(plan).toBe("free");
  });
});

describe("createSubscription", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should reject free plan", async () => {
    const result = await billingService.createSubscription("test.myshopify.com", "free", "token");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("free plan");
  });

  it("should return confirmationUrl on success", async () => {
    mockGraphql.mockResolvedValue({
      appSubscriptionCreate: {
        confirmationUrl: "https://checkout.shopify.com/confirm",
        userErrors: [],
      },
    });

    const result = await billingService.createSubscription("test.myshopify.com", "pro", "token");
    expect(result).toHaveProperty("confirmationUrl");
    expect((result as { confirmationUrl: string }).confirmationUrl).toContain("checkout.shopify.com");
  });

  it("should return error on user errors from Shopify", async () => {
    mockGraphql.mockResolvedValue({
      appSubscriptionCreate: {
        userErrors: [{ field: ["price"], message: "Invalid price" }],
      },
    });

    const result = await billingService.createSubscription("test.myshopify.com", "pro", "token");
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toBe("Invalid price");
  });
});

describe("handleSubscriptionActivated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should update shop plan on activation", async () => {
    mockPrisma.shop.updateMany.mockResolvedValue({ count: 1 });
    await billingService.handleSubscriptionActivated("test.myshopify.com", "Pro", "ACTIVE");
    expect(mockPrisma.shop.updateMany).toHaveBeenCalledWith({
      where: { shopifyDomain: "test.myshopify.com" },
      data: { plan: "pro" },
    });
  });

  it("should handle unknown plan name gracefully", async () => {
    mockPrisma.shop.updateMany.mockResolvedValue({ count: 0 });
    await billingService.handleSubscriptionActivated("test.myshopify.com", "UnknownPlan", "ACTIVE");
    // Should not call updateMany for unknown plan
    expect(mockPrisma.shop.updateMany).not.toHaveBeenCalled();
  });
});

describe("handleSubscriptionDeactivated", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should downgrade shop to free plan", async () => {
    mockPrisma.shop.updateMany.mockResolvedValue({ count: 1 });
    await billingService.handleSubscriptionDeactivated("test.myshopify.com");
    expect(mockPrisma.shop.updateMany).toHaveBeenCalledWith({
      where: { shopifyDomain: "test.myshopify.com" },
      data: { plan: "free" },
    });
  });
});
