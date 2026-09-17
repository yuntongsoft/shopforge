/**
 * File: routes/app.theme-widget.tsx
 * Author: yuntongsoft
 * Date: 2026/09/08
 * Purpose: [DEMO] Theme Widget config — route wrapper with server-side logic
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
import { shopifyAdmin } from "~/services/shopify-admin";
import { rateLimit, RATE_LIMIT_PRESETS } from "~/utils/rate-limiter";
import { generateCsrfToken, validateCsrfRequest } from "~/utils/csrf";
import { getErrorMessage } from "~/utils/errors";
import { createLogger } from "~/utils/logger";

// Re-export the demo component (pure React, no server deps)
export { default } from "~/demo/routes/theme-widget";

const logger = createLogger({ module: "theme-widget" });

const METAFIELD_NAMESPACE = "custom";
const METAFIELD_KEY = "shopforge_widget";

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — Read current config from metafield
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return auth.response;
  const shop = auth.shop;
  const api = shopifyAdmin(shop.shopifyDomain);

  let config = { heading: "You May Also Like", productCount: "4" };
  try {
    const value = await api.getShopMetafield(METAFIELD_NAMESPACE, METAFIELD_KEY);
    if (value) {
      const parsed = JSON.parse(value);
      config = { ...config, ...parsed };
    }
  } catch {
    // Metafield doesn't exist yet — use defaults
  }

  return json({ config, csrfToken: generateCsrfToken() });
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTION — Save config to metafield
// ─────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return auth.response;
  const shop = auth.shop;

  const limited = await rateLimit(`theme-widget:${shop.id}`, RATE_LIMIT_PRESETS.write);
  if (limited) {
    return json(
      { error: `Rate limited. Try again in ${Math.ceil(limited.retryAfter / 1000)}s` },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limited.retryAfter / 1000)) } }
    );
  }

  let formData: FormData;
  try {
    formData = await validateCsrfRequest(request);
  } catch {
    return json({ error: "Invalid or expired CSRF token. Please refresh the page." }, { status: 403 });
  }
  const heading = (formData.get("heading") as string || "").trim();
  const productCount = formData.get("productCount") as string;

  if (!heading) return json({ error: "Heading is required" });
  if (!productCount || isNaN(Number(productCount))) return json({ error: "Product count must be a number" });
  const productCountNum = Number(productCount);
  if (productCountNum < 1 || productCountNum > 20) return json({ error: "Product count must be between 1 and 20" });

  const api = shopifyAdmin(shop.shopifyDomain);
  try {
    await api.setShopMetafield(
      METAFIELD_NAMESPACE,
      METAFIELD_KEY,
      JSON.stringify({ heading, productCount: productCountNum }),
      "JSON"
    );
    logger.info({ shop: shop.shopifyDomain }, "Theme widget config updated");
    return json({ success: true, message: "Widget configuration saved" });
  } catch (error) {
    logger.error({ shop: shop.shopifyDomain, error: getErrorMessage(error) }, "Failed to save widget config");
    return json({ error: "Failed to save configuration" });
  }
};
