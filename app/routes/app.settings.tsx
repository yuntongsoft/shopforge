/**
 * File: routes/app.settings.tsx
 * Author: yuntongsoft
 * Date: 2026/09/04
 * Purpose: Settings page — shop info, language preference, app info
 */
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Divider,
  Icon,
  Badge,
  Select,
  Button,
  Toast,
  Frame,
} from "@shopify/polaris";
import { useLoaderData } from "@remix-run/react";
import { getAppBridge } from "~/utils/app-bridge.client";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticatePage, authResponse } from "~/utils/shopify-auth.server";
import { apiError, apiSuccess } from "~/utils/api-response";
import { APP_SCOPES } from "~/shopify.server";
import { SHOPIFY_API_VERSION } from "~/utils/shopify-config";
import prisma from "~/db.server";
import { useTranslation, saveLocale as syncLocale } from "~/utils/i18n";
import { generateCsrfToken, validateCsrfRequest } from "~/utils/csrf";
import {
  StoreIcon,
  CreditCardIcon,
  KeyIcon,
  CalendarIcon,
  SettingsIcon,
  InfoIcon,
  LanguageIcon,
} from "@shopify/polaris-icons";
import { useState, useCallback, useEffect } from "react";

export { PageErrorBoundary as ErrorBoundary } from "~/components/PageErrorBoundary";

// ─────────────────────────────────────────────────────────────────────────────
// Supported languages
// ─────────────────────────────────────────────────────────────────────────────
const SUPPORTED_LOCALES = [
  { label: "English", value: "en" },
  { label: "中文 (简体)", value: "zh" },
  { label: "日本語", value: "ja" },
  { label: "Español", value: "es" },
];

const APP_VERSION = "1.0.0";

// ─────────────────────────────────────────────────────────────────────────────
// LOADER
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return authResponse(auth);
  const shop = auth.shop;

  return json({
    shop: shop.shopifyDomain,
    plan: shop.plan || "free",
    scopes: APP_SCOPES.join(","),
    locale: shop.locale || "en",
    installedAt: shop.createdAt?.toISOString() || "",
    csrfToken: generateCsrfToken(),
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// ACTION — save locale to DB + set cookie
// ─────────────────────────────────────────────────────────────────────────────
export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return authResponse(auth);

  let formData: FormData;
  try {
    formData = await validateCsrfRequest(request);
  } catch {
    return apiError("Invalid or expired CSRF token. Please refresh the page.", 403);
  }
  const intent = formData.get("intent");

  if (intent === "saveLocale") {
    const locale = String(formData.get("locale") || "en");
    if (!SUPPORTED_LOCALES.some((l) => l.value === locale)) {
      return apiError("Invalid locale", 400);
    }

    await prisma.shop.update({
      where: { shopifyDomain: auth.shop.shopifyDomain },
      data: { locale },
    });

    // Set cookie so client-side i18n picks it up immediately
    const headers = new Headers();
    headers.append(
      "Set-Cookie",
      `shopforge_locale=${locale}; Path=/; Max-Age=31536000; SameSite=None; Secure`
    );

    return apiSuccess({ locale }, undefined, headers);
  }

  return apiError("Unknown action", 400);
};

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { shop, plan, scopes, locale, installedAt, csrfToken } =
    useLoaderData<typeof loader>() ?? { shop: "", plan: "free", scopes: "", locale: "en", installedAt: "", csrfToken: "" };
  const { t } = useTranslation(locale);

  // Defer App Bridge access to client-side only — avoids SSR import issues
  const [shopify, setShopify] = useState<ReturnType<typeof getAppBridge>>(null);
  useEffect(() => { setShopify(getAppBridge()); }, []);

  const [selectedLocale, setSelectedLocale] = useState(locale || "en");
  const [savedLocale, setSavedLocale] = useState(locale || "en");
  const [saveSuccess, setSaveSuccess] = useState(false);

  const formattedScopes = scopes
    ? scopes
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean)
    : [];

  /**
   * Save locale — client-side first (cookie + localStorage + CustomEvent).
   * Server DB save is fire-and-forget (best-effort, not blocking UX).
   * Language preference is a UI concern — cookie is the source of truth.
   */
  const handleSaveLocale = useCallback(() => {
    // 1. Immediately persist to cookie + localStorage + notify all components
    syncLocale(selectedLocale);
    setSavedLocale(selectedLocale);
    setSaveSuccess(true);

    // 2. Best-effort server save (fire-and-forget) — include CSRF token
    shopify?.idToken?.().then((token: string) => {
      const formData = new FormData();
      formData.set("intent", "saveLocale");
      formData.set("locale", selectedLocale);
      formData.set("csrfToken", csrfToken);
      fetch(`/app/settings?id_token=${encodeURIComponent(token)}`, {
        method: "POST",
        body: formData,
      }).catch(() => {/* server save failed — client locale still works */});
    }).catch(() => {/* idToken failed — client locale still works */});
  }, [selectedLocale, shopify, csrfToken]);

  const handleSaveSuccess = useCallback(() => setSaveSuccess(false), []);

  return (
    <Frame>
    <Page
      title={t("settings.title")}
      backAction={{ content: t("settings.backToDashboard"), url: "/app" }}
    >
      <Layout>
        {/* Shop Information */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <div className="sf-section-header">
                <Icon source={StoreIcon} tone="base" />
                <Text as="h2" variant="headingMd">
                  {t("settings.shopInfo")}
                </Text>
              </div>
              <Divider />
              <div className="sf-settings-list">
                <SettingRow
                  icon={StoreIcon}
                  label={t("settings.shop")}
                  value={shop}
                />
                <SettingRow
                  icon={CreditCardIcon}
                  label={t("settings.plan")}
                  value={<Badge tone="new">{(plan || "free").toUpperCase()}</Badge>}
                />
                <SettingRow
                  icon={KeyIcon}
                  label={t("settings.scopes")}
                  value={
                    <InlineStack gap="100" wrap>
                      {formattedScopes.length > 0 ? (
                        formattedScopes.map((scope: string) => (
                          <Badge key={scope} tone="info">
                            {scope}
                          </Badge>
                        ))
                      ) : (
                        <Text as="span" variant="bodyMd" tone="subdued">
                          —
                        </Text>
                      )}
                    </InlineStack>
                  }
                />
                <SettingRow
                  icon={CalendarIcon}
                  label={t("settings.installed")}
                  value={
                    installedAt
                      ? new Date(installedAt).toLocaleDateString()
                      : "N/A"
                  }
                />
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Language Preferences */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <div className="sf-section-header">
                <Icon source={LanguageIcon} tone="base" />
                <Text as="h2" variant="headingMd">
                  {t("settings.language")}
                </Text>
              </div>
              <Divider />
              <BlockStack gap="300">
                <Text as="p" variant="bodyMd" tone="subdued">
                  {t("settings.languageHint")}
                </Text>
                <InlineStack gap="200" blockAlign="end">
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <Select
                      label={t("settings.languageLabel")}
                      options={SUPPORTED_LOCALES}
                      value={selectedLocale}
                      onChange={setSelectedLocale}
                    />
                  </div>
                  <Button
                    variant="primary"
                    onClick={handleSaveLocale}
                    disabled={selectedLocale === savedLocale}
                  >
                    {t("settings.saveLanguage")}
                  </Button>
                </InlineStack>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* App Information */}
        <Layout.Section variant="oneHalf">
          <Card>
            <BlockStack gap="400">
              <div className="sf-section-header">
                <Icon source={InfoIcon} tone="base" />
                <Text as="h2" variant="headingMd">
                  {t("settings.appInfo")}
                </Text>
              </div>
              <Divider />
              <div className="sf-settings-list">
                <SettingRow
                  icon={SettingsIcon}
                  label={t("settings.appVersion")}
                  value={`v${APP_VERSION}`}
                />
                <SettingRow
                  icon={InfoIcon}
                  label={t("settings.apiVersion")}
                  value={SHOPIFY_API_VERSION}
                />
              </div>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>

      {saveSuccess && (
        <Toast content={t("settings.languageSaved")} onDismiss={handleSaveSuccess} />
      )}
    </Page>
    </Frame>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SettingRow — reusable key-value row with icon
// ─────────────────────────────────────────────────────────────────────────────
function SettingRow({
  icon,
  label,
  value,
}: {
  icon: React.FC<any> | string;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="sf-settings-row">
      <div className="sf-settings-row-left">
        <Icon source={icon} tone="base" />
        <Text as="span" variant="bodyMd" tone="subdued">
          {label}
        </Text>
      </div>
      <div className="sf-settings-row-right">{value}</div>
    </div>
  );
}
