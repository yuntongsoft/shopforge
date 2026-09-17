/**
 * File: routes/app.discounts.tsx
 * Author: yuntongsoft
 * Date: 2026/09/08
 * Purpose: [DEMO] Discount management — route wrapper with server-side logic
 *
 * ============================================================================
 * DEMO ROUTE — Delete this file + app/demo/ to remove all demo code
 * ============================================================================
 *
 * Server-only imports live HERE (in app/routes/) so Remix's Vite plugin
 * strips them from the client bundle. The demo component in app/demo/
 * only contains pure React code.
 */
import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticatePage } from "~/utils/shopify-auth.server";
import { discountApi } from "~/demo/services/discount-api";
import { ruleEngine } from "~/demo/services/rule-engine";
import { rateLimit, RATE_LIMIT_PRESETS } from "~/utils/rate-limiter";
import { generateCsrfToken, validateCsrfRequest } from "~/utils/csrf";
import { getTranslation } from "~/utils/i18n";
import { createLogger } from "~/utils/logger";

// Re-export the demo component (pure React, no server deps)
export { default } from "~/demo/routes/discounts";

const logger = createLogger({ module: "discounts" });

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — List existing discounts
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return auth.response;
  const shop = auth.shop;
  const api = discountApi(shop.shopifyDomain);

  const discounts = await api.listDiscounts();

  return json({ discounts, csrfToken: generateCsrfToken() });
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTION — Create / Update / Delete discounts
// ─────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return auth.response;
  const shop = auth.shop;
  const accessToken = auth.accessToken;

  // i18n for server-side action messages
  const { t } = getTranslation(request.headers.get("Accept-Language")?.slice(0, 2) || "en");

  // Rate limit write operations
  const limited = await rateLimit(`discounts:${shop.id}`, RATE_LIMIT_PRESETS.write);
  if (limited) {
    return json({ error: t("discounts.errorRateLimited", { seconds: String(Math.ceil(limited.retryAfter / 1000)) }) }, { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfter / 1000)) } });
  }

  // CSRF validation
  let formData: FormData;
  try {
    formData = await validateCsrfRequest(request);
  } catch {
    return json({ error: t("discounts.errorCsrfInvalid") }, { status: 403 });
  }
  const actionType = formData.get("_action") as string;
  const engine = ruleEngine(shop.shopifyDomain, accessToken, String(shop.id));

  switch (actionType) {
    case "create": {
      const title = (formData.get("title") as string || "").trim();
      const minSubtotal = (formData.get("minSubtotal") as string || "").trim();
      const discountPercent = formData.get("discountPercent") as string;

      if (!title) return json({ error: t("discounts.errorTitleRequired") });
      if (!minSubtotal || isNaN(Number(minSubtotal))) return json({ error: t("discounts.errorMinSubtotalNumber") });
      if (!discountPercent || isNaN(Number(discountPercent))) return json({ error: t("discounts.errorDiscountPercentNumber") });
      if (Number(discountPercent) <= 0 || Number(discountPercent) > 100) return json({ error: t("discounts.errorDiscountPercentRange") });

      const result = await engine.createDiscount({
        type: "order-discount",
        title,
        rule: {
          minSubtotal: Number(minSubtotal),
          discountPercent: Number(discountPercent),
        },
      });

      if (result.error) {
        logger.error({ shop: shop.shopifyDomain, error: result.error }, "Failed to create discount");
        return json({ error: result.error });
      }

      logger.info({ shop: shop.shopifyDomain, discountId: result.discount?.id, title }, "Discount created via UI");
      return json({ success: true, message: t("discounts.successCreated", { title }) });
    }

    case "update": {
      const discountId = (formData.get("discountId") as string || "").trim();
      const minSubtotal = (formData.get("minSubtotal") as string || "").trim();
      const discountPercent = formData.get("discountPercent") as string;

      if (!discountId) return json({ error: t("discounts.errorDiscountIdRequired") });
      if (!minSubtotal || isNaN(Number(minSubtotal))) return json({ error: t("discounts.errorMinSubtotalNumber") });
      if (!discountPercent || isNaN(Number(discountPercent))) return json({ error: t("discounts.errorDiscountPercentNumber") });
      if (Number(discountPercent) <= 0 || Number(discountPercent) > 100) return json({ error: t("discounts.errorDiscountPercentRange") });

      const result = await engine.updateDiscount(discountId, "order-discount", {
        minSubtotal: Number(minSubtotal),
        discountPercent: Number(discountPercent),
      });

      if (!result.success) {
        logger.error({ shop: shop.shopifyDomain, error: result.error }, "Failed to update discount");
        return json({ error: result.error });
      }

      logger.info({ shop: shop.shopifyDomain, discountId }, "Discount config updated via UI");
      return json({ success: true, message: t("discounts.successUpdated") });
    }

    case "delete": {
      const discountId = formData.get("discountId") as string;
      if (!discountId) return json({ error: t("discounts.errorDiscountIdRequired") });

      const result = await engine.deleteDiscount(discountId);
      if (!result.success) return json({ error: result.error });

      return json({ success: true, message: t("discounts.successDeactivated") });
    }

    default:
      return json({ error: t("discounts.errorUnknownAction") });
  }
};
