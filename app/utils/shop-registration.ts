/**
 * File: utils/shop-registration.ts
 * Author: yuntongsoft
 * Date: 2026/08/21
 * Purpose: Shared shop registration logic — eliminates duplication between
 *          auth.$.tsx and auth.callback.tsx.
 *
 * Handles both new shop creation and re-installation (token refresh).
 *
 * Dependencies: prisma, encryption, logger
 */
import prisma from "~/db.server";
import { encrypt } from "~/utils/encryption";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "shop-registration" });

/**
 * Register a new shop or update an existing shop's token after OAuth.
 *
 * Uses Prisma upsert for atomic create-or-update — prevents race conditions
 * when concurrent OAuth callbacks arrive for the same shop domain.
 *
 * @param shopDomain - Shopify shop domain (e.g. "example.myshopify.com")
 * @param accessToken - Plain-text access token from OAuth session
 * @param scope - Granted API scopes
 */
export async function registerShop(
  shopDomain: string,
  accessToken: string,
  scope: string
): Promise<void> {
  // Build update data — only overwrite scope if a non-empty value is provided
  const updateData: Record<string, unknown> = {
    shopifyToken: encrypt(accessToken),
    isDeleted: false,
  };
  if (scope) {
    updateData.shopifyScope = scope;
  }

  await prisma.shop.upsert({
    where: { shopifyDomain: shopDomain },
    update: updateData,
    create: {
      shopifyDomain: shopDomain,
      shopifyToken: encrypt(accessToken),
      shopifyScope: scope,
      isDeleted: false,
    },
  });
  logger.info({ shop: shopDomain }, "Shop registered/reinstalled via OAuth");
}

