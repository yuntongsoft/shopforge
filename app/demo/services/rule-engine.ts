/**
 * File: demo/services/rule-engine.ts
 * Author: yuntongsoft
 * Date: 2026/09/07
 * Purpose: High-level discount rule API — developers create discounts using
 *          pure business parameters, never seeing Function IDs or metafields.
 *
 * ============================================================================
 * DEMO CODE — Delete app/demo/ to remove all demo code
 * ============================================================================
 *
 * This is the KEY abstraction that hides Shopify Function complexity.
 * Instead of:
 *   discountApi(shop, token).createDiscount({
 *     title: "10% off",
 *     functionId: "gid://shopify/Function/xxx",  // developer shouldn't see this
 *     config: { minSubtotal: "50", discountPercent: 10 },
 *   })
 *
 * Developers write:
 *   ruleEngine(shop, token).createDiscount({
 *     type: "order-discount",
 *     title: "10% off $50+",
 *     rule: { minSubtotal: 50, discountPercent: 10 },
 *   })
 *
 * Dependencies: ./function-registry, ./discount-api, logger (infrastructure)
 */
import { functionRegistry, type RuleType } from "./function-registry";
import { discountApi } from "./discount-api";
import { createLogger } from "~/utils/logger";
import { getErrorMessage } from "~/utils/errors";

const logger = createLogger({ module: "rule-engine" });

// ─────────────────────────────────────────────────────────────────────────────
// Types — pure business concepts, no Shopify internals
// ─────────────────────────────────────────────────────────────────────────────

/** Discount rule for spend-threshold percentage off */
export interface OrderDiscountRule {
  /** Minimum cart subtotal to trigger (in shop currency) */
  minSubtotal: number;
  /** Discount percentage (0-100) */
  discountPercent: number;
}

/** Discount rule for free shipping */
export interface FreeShippingRule {
  /** Minimum cart subtotal to trigger free shipping */
  minSubtotal: number;
  /** Optional custom message shown to customer */
  message?: string;
}

/** Discount rule for volume/bulk discounts */
export interface VolumeDiscountRule {
  /** Tiered discounts: buy more → save more */
  tiers: Array<{
    /** Minimum quantity to trigger this tier */
    minQty: number;
    /** Discount percentage for this tier (0-100) */
    percent: number;
  }>;
}

/** Discount rule for BOGO (Buy X Get Y) */
export interface BogoRule {
  /** Quantity customer must buy */
  buyQty: number;
  /** Quantity customer gets free */
  getQty: number;
  /** Optional: limit to specific product IDs */
  productIds?: string[];
}

/** Union of all rule types */
export type DiscountRule = OrderDiscountRule | FreeShippingRule | VolumeDiscountRule | BogoRule;

/**
 * Input for creating a discount — discriminated union ensures type-safe
 * pairing of rule type and rule parameters at compile time.
 *
 * Example: type: "order-discount" forces rule: OrderDiscountRule.
 */
export type CreateDiscountInput =
  | { type: "order-discount"; title: string; rule: OrderDiscountRule; startsAt?: string; endsAt?: string }
  | { type: "free-shipping"; title: string; rule: FreeShippingRule; startsAt?: string; endsAt?: string }
  | { type: "volume-discount"; title: string; rule: VolumeDiscountRule; startsAt?: string; endsAt?: string }
  | { type: "bogo"; title: string; rule: BogoRule; startsAt?: string; endsAt?: string };

/** Result of creating a discount */
export interface DiscountResult {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a Rule Engine client bound to a shop.
 *
 * Usage:
 *   const engine = ruleEngine(shopDomain, accessToken, shopId);
 *   const result = await engine.createDiscount({
 *     type: "order-discount",
 *     title: "Summer Sale: 10% off $50+",
 *     rule: { minSubtotal: 50, discountPercent: 10 },
 *   });
 */
export function ruleEngine(shopDomain: string, _accessToken: string, shopId: string) {
  const api = discountApi(shopDomain);

  /**
   * Create a discount using pure business parameters.
   * Internally resolves the Function ID and converts the rule to metafield format.
   */
  async function createDiscount(input: CreateDiscountInput): Promise<{
    discount?: DiscountResult;
    error?: string;
  }> {
    const { type, title, rule, startsAt, endsAt } = input;

    // 1. Resolve Function ID (developer never sees this)
    let functionId: string;
    try {
      functionId = await functionRegistry.getFunctionId(shopId, type);
    } catch (error) {
      return { error: getErrorMessage(error) };
    }

    // 2. Convert business rule to Function-compatible metafield config
    const config = ruleToConfig(type, rule);

    // 3. Create discount via the underlying API
    logger.info({ shopDomain, type, title }, "Creating discount via rule engine");
    const result = await api.createDiscount({
      title,
      functionId,
      config,
      startsAt,
      endsAt,
    });

    if (result.error) {
      return { error: result.error };
    }

    return { discount: result.discount as DiscountResult };
  }

  /**
   * Update an existing discount's rule (e.g. change threshold or percentage).
   * Developer just passes new business parameters — Function ID stays the same.
   */
  async function updateDiscount(
    discountId: string,
    type: RuleType,
    rule: DiscountRule
  ): Promise<{ success: boolean; error?: string }> {
    const config = ruleToConfig(type, rule);
    return api.updateDiscountConfig(discountId, config);
  }

  /**
   * Delete (deactivate) a discount.
   */
  async function deleteDiscount(
    discountId: string
  ): Promise<{ success: boolean; error?: string }> {
    return api.deleteDiscount(discountId);
  }

  return { createDiscount, updateDiscount, deleteDiscount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: Convert business rule to Function metafield config
// ─────────────────────────────────────────────────────────────────────────────

function ruleToConfig(type: RuleType, rule: DiscountRule): Record<string, unknown> {
  switch (type) {
    case "order-discount": {
      const r = rule as OrderDiscountRule;
      return {
        minSubtotal: r.minSubtotal.toFixed(2),
        discountPercent: r.discountPercent,
      };
    }
    case "free-shipping": {
      const r = rule as FreeShippingRule;
      return {
        minSubtotal: r.minSubtotal.toFixed(2),
        ...(r.message ? { freeShippingMessage: r.message } : {}),
      };
    }
    case "volume-discount": {
      const r = rule as VolumeDiscountRule;
      return { tiers: r.tiers };
    }
    case "bogo": {
      const r = rule as BogoRule;
      return {
        buyQty: r.buyQty,
        getQty: r.getQty,
        ...(r.productIds ? { productIds: r.productIds } : {}),
      };
    }
    default:
      throw new Error(`Unknown rule type: ${type}`);
  }
}
