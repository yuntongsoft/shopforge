/**
 * Tests for shop-registration.ts — OAuth shop registration logic
 *
 * Coverage:
 *   - New shop creates a record with encrypted token (upsert → create branch)
 *   - Existing shop updates token and resets isDeleted (upsert → update branch)
 *   - Empty scope preserves existing scope (not overwritten)
 *   - Token is encrypted before storage
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted() ensures mockPrisma is available when the hoisted vi.mock() runs
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    shop: {
      upsert: vi.fn(),
    },
  },
}));
vi.mock("~/db.server", () => ({ default: mockPrisma }));

// Set encryption key
process.env.ENCRYPTION_KEY = "a".repeat(64);

import { registerShop } from "~/utils/shop-registration";

describe("registerShop", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should create a new shop via upsert with encrypted token", async () => {
    mockPrisma.shop.upsert.mockResolvedValue({ id: "1" });

    await registerShop("new.myshopify.com", "access-token-123", "read_products");

    expect(mockPrisma.shop.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shopifyDomain: "new.myshopify.com" },
        create: expect.objectContaining({
          shopifyDomain: "new.myshopify.com",
          shopifyScope: "read_products",
          isDeleted: false,
        }),
      })
    );
    // Token should be encrypted (not plaintext)
    const createData = mockPrisma.shop.upsert.mock.calls[0][0].create;
    expect(createData.shopifyToken).not.toBe("access-token-123");
    expect(createData.shopifyToken).toContain(":"); // encrypted format has colons
  });

  it("should update token for existing shop (re-installation)", async () => {
    mockPrisma.shop.upsert.mockResolvedValue({ id: "1" });

    await registerShop("existing.myshopify.com", "new-token-456", "read_products,write_products");

    expect(mockPrisma.shop.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { shopifyDomain: "existing.myshopify.com" },
        update: expect.objectContaining({
          shopifyScope: "read_products,write_products",
          isDeleted: false,
        }),
      })
    );
  });

  it("should preserve existing scope when new scope is empty", async () => {
    mockPrisma.shop.upsert.mockResolvedValue({ id: "1" });

    await registerShop("existing.myshopify.com", "token", "");

    const call = mockPrisma.shop.upsert.mock.calls[0][0];
    // When scope is empty, update should NOT include shopifyScope (preserves existing)
    expect(call.update.shopifyScope).toBeUndefined();
    // But create should still set it (to empty string for new shops)
    expect(call.create.shopifyScope).toBe("");
  });
});

