/**
 * File: routes/app.tsx
 * Author: yuntongsoft
 * Date: 2026/08/24
 * Purpose: App shell — wraps all pages with AppProvider + Polaris + Toast
 *
 * IMPORTANT: This layout loader MUST NOT call authenticate.admin() when
 * unstable_newEmbeddedAuthStrategy is enabled. That would trigger a bounce
 * to /auth/login on every page load, causing an infinite redirect loop.
 * Instead, we manually verify the id_token and fall back to DB lookup.
 *
 * Dependencies: @shopify/shopify-app-remix, @shopify/polaris, shopify-auth
 * Used by: Remix route system (parent layout)
 */
import { Outlet, useLoaderData, useSearchParams } from "@remix-run/react";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";
import appStyles from "~/styles/app.css?url";
import polarisEn from "@shopify/polaris/locales/en.json";
import polarisZh from "@shopify/polaris/locales/zh-CN.json";
import polarisJa from "@shopify/polaris/locales/ja.json";
import polarisEs from "@shopify/polaris/locales/es.json";

/** Map app locale codes to Polaris translation files */
const POLARIS_I18N: Record<string, unknown> = {
  en: polarisEn,
  zh: polarisZh,
  ja: polarisJa,
  es: polarisEs,
};
import type { LoaderFunctionArgs } from "@remix-run/node";
import type { LinksFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useState, useEffect } from "react";
import { useTranslation } from "~/utils/i18n";
import { verifySessionToken, isValidShopDomain } from "~/utils/shopify-auth.server";
import { createLogger } from "~/utils/logger";

const logger = createLogger({ module: "app" });

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: appStyles },
];

/**
 * App layout loader — returns apiKey for AppProvider + locale from DB.
 * Loading locale here ensures ALL pages and nav menu get the correct language.
 *
 * AUTH NOTE: We manually verify id_token instead of calling authenticate.admin().
 * With unstable_newEmbeddedAuthStrategy enabled, authenticate.admin() bounces to
 * /auth/login on every load, causing an infinite redirect loop in embedded apps.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const idToken = url.searchParams.get("id_token");
  const urlShop = url.searchParams.get("shop");
  let verifiedShop: string | null = null;

  // 1. Verify id_token from App Bridge (JWT signed by Shopify)
  if (idToken) {
    try {
      const payload = verifySessionToken(idToken);
      verifiedShop = payload.dest.replace(/^https?:\/\//, "");
    } catch (error) {
      logger.debug({ error: (error as Error).message }, "Failed to verify id_token in app.tsx loader");
    }
  }

  // 2. Fallback to URL shop param (handles expired/missing session tokens)
  if (!verifiedShop && urlShop && isValidShopDomain(urlShop)) {
    verifiedShop = urlShop;
  }

  // 3. DB fallback — most recently installed shop (single-shop dev environments)
  if (!verifiedShop) {
    try {
      const prisma = (await import("~/db.server")).default;
      const lastShop = await prisma.shop.findFirst({
        where: { isDeleted: false },
        orderBy: { createdAt: "desc" },
        select: { shopifyDomain: true },
      });
      if (lastShop) verifiedShop = lastShop.shopifyDomain;
    } catch {
      // DB unavailable — fall through
    }
  }

  // 4. Read locale from DB (URL param > DB preference > default "en")
  let locale = "en";
  if (verifiedShop) {
    try {
      const prisma = (await import("~/db.server")).default;
      const shop = await prisma.shop.findUnique({
        where: { shopifyDomain: verifiedShop },
        select: { locale: true },
      });
      if (shop?.locale) locale = shop.locale;
    } catch {
      // DB lookup failed — default to "en"
    }
  }

  return json({ apiKey: process.env.SHOPIFY_API_KEY!, locale });
};

export default function AppLayout() {
  const { apiKey, locale } = useLoaderData<typeof loader>();
  const { t } = useTranslation(locale);
  const [searchParams] = useSearchParams();

  // SSR guard: NavMenu (from @shopify/app-bridge-react) accesses `window` during
  // hydration. Defer rendering until client-side mount to prevent SSR mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Preserve shop/id_token params for App Bridge navigation
  // NOTE: Do NOT propagate Shopify admin's ?locale= param — it's the admin UI locale,
  // not the user's app language preference (which comes from DB via loader).
  const buildLink = (path: string) => {
    const params = new URLSearchParams();
    const shop = searchParams.get("shop");
    const idToken = searchParams.get("id_token");
    if (shop) params.set("shop", shop);
    if (idToken) params.set("id_token", idToken);
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };

  return (
    <AppProvider apiKey={apiKey} i18n={(POLARIS_I18N[locale] || polarisEn) as typeof polarisEn} isEmbeddedApp>
      {mounted && (
        <NavMenu>
          <a href={buildLink("/app")} rel="home">{t("nav.home")}</a>
          <a href={buildLink("/app/order")}>{t("nav.orders")}</a>
          <a href={buildLink("/app/discounts")}>{t("nav.discounts")}</a>
          <a href={buildLink("/app/theme-widget")}>{t("nav.themeWidget")}</a>
          <a href={buildLink("/app/pricing")}>{t("nav.pricing")}</a>
          <a href={buildLink("/app/settings")}>{t("nav.settings")}</a>
        </NavMenu>
      )}
      <Outlet />
    </AppProvider>
  );
}
