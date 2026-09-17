/**
 * File: routes/app.tsx
 * Author: yuntongsoft
 * Date: 2026/08/24
 * Purpose: App shell — wraps all pages with AppProvider + Polaris + Toast
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
import { useTranslation } from "~/utils/i18n";
import { authenticatePage } from "~/utils/shopify-auth.server";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: polarisStyles },
  { rel: "stylesheet", href: appStyles },
];

/**
 * App layout loader — returns apiKey for AppProvider + locale from DB.
 * Loading locale here ensures ALL pages and nav menu get the correct language.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  let locale = "en";
  try {
    const auth = await authenticatePage(request);
    if (auth.ok && auth.shop.locale) {
      locale = auth.shop.locale;
    }
  } catch {
    // Auth failed — default to "en", child routes will handle redirect
  }
  return json({ apiKey: process.env.SHOPIFY_API_KEY!, locale });
};

export default function AppLayout() {
  const { apiKey, locale } = useLoaderData<typeof loader>();
  const { t } = useTranslation(locale);
  const [searchParams] = useSearchParams();

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
      <NavMenu>
        <a href={buildLink("/app")} rel="home">{t("nav.home")}</a>
        <a href={buildLink("/app/order")}>{t("nav.orders")}</a>
        <a href={buildLink("/app/discounts")}>{t("nav.discounts")}</a>
        <a href={buildLink("/app/theme-widget")}>{t("nav.themeWidget")}</a>
        <a href={buildLink("/app/pricing")}>{t("nav.pricing")}</a>
        <a href={buildLink("/app/settings")}>{t("nav.settings")}</a>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}
