/**
 * File: utils/shopify-config.ts
 * Author: yuntongsoft
 * Date: 2026/08/01
 * Purpose: Shared Shopify API configuration constants.
 *
 * Central place for API version and other SDK-wide settings.
 * All services (shopify.server.ts, shopify-admin.ts, billing.service.ts)
 * should import from here instead of hardcoding values.
 *
 * Dependencies: @shopify/shopify-app-remix (for ApiVersion enum)
 * Used by: shopify.server.ts, billing.service.ts
 */
import { ApiVersion } from "@shopify/shopify-app-remix/server";

/**
 * Shopify Admin API version to use across all services.
 * This is the SINGLE SOURCE OF TRUTH — both the SDK initialization
 * (shopify.server.ts) and raw GraphQL calls (billing.service.ts) import
 * this constant, so they can never drift out of sync.
 *
 * Update this when upgrading to a newer API version.
 * See: https://shopify.dev/docs/api/versions
 */
// NOTE: SDK enum may lag behind actual latest version. Use string cast for newer versions.
export const SHOPIFY_API_VERSION_ENUM = "2026-07" as ApiVersion;

/**
 * String form of the API version — used in raw fetch() URLs where the
 * SDK enum isn't available (e.g. billing GraphQL calls).
 * Derived from the enum so there's only one place to update.
 */
export const SHOPIFY_API_VERSION = SHOPIFY_API_VERSION_ENUM as string;
