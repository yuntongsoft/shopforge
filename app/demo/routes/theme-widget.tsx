/**
 * File: demo/routes/theme-widget.tsx
 * Author: yuntongsoft
 * Date: 2026/09/11
 * Purpose: [DEMO] Theme Widget configuration page — writes config to shop metafield
 *
 * ============================================================================
 * DEMO COMPONENT — Pure React UI, no server-only imports
 * Server logic (loader/action) lives in routes/app.theme-widget.tsx
 * ============================================================================
 *
 * Dependencies: @shopify/polaris, @remix-run/react, i18n
 */
import { useLoaderData, useRouteLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  FormLayout,
  TextField,
  Select,
  Text,
  Button,
  BlockStack,
  Banner,
  Icon,
} from "@shopify/polaris";
import { PaintBrushRoundIcon, CheckIcon } from "@shopify/polaris-icons";
import { useState } from "react";
import { Form, useActionData } from "@remix-run/react";
import { useTranslation } from "~/utils/i18n";

// ─────────────────────────────────────────────────────────────────────────────
// Types (must match wrapper loader/action response shape)
// ─────────────────────────────────────────────────────────────────────────────
interface ThemeWidgetLoaderData {
  config: {
    heading: string;
    productCount: string;
  };
  csrfToken: string;
}

interface ThemeWidgetActionData {
  success?: boolean;
  message?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────
export default function ThemeWidgetPage() {
  const { config, csrfToken } = useLoaderData<ThemeWidgetLoaderData>();
  const actionData = useActionData<ThemeWidgetActionData>();
  const { t } = useTranslation(useRouteLoaderData<typeof import("~/routes/app").loader>("routes/app")?.locale);
  const [heading, setHeading] = useState(config.heading);
  const [productCount, setProductCount] = useState(String(config.productCount || "4"));

  return (
    <Page
      title={t("themeWidget.title")}
      subtitle={t("themeWidget.subtitle")}
    >
      <BlockStack gap="500">
        {/* How it works — step-by-step */}
        <Card>
          <BlockStack gap="400">
            <div className="sf-section-header">
              <Icon source={PaintBrushRoundIcon} tone="base" />
              <Text as="h2" variant="headingMd">{t("themeWidget.howItWorks")}</Text>
            </div>
            <div className="sf-steps-card">
              <div className="sf-steps">
              <div className="sf-step">
                <span className="sf-step-num">1</span>
                <div className="sf-step-text">
                  {t("themeWidget.step1")}
                </div>
              </div>
              <div className="sf-step">
                <span className="sf-step-num">2</span>
                <div className="sf-step-text">
                  {t("themeWidget.step2")}
                </div>
              </div>
              <div className="sf-step">
                <span className="sf-step-num">3</span>
                <div className="sf-step-text">
                  {t("themeWidget.step3")}
                </div>
              </div>
            </div>
            </div>
          </BlockStack>
        </Card>

        {/* Configuration form */}
        <Card>
          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <BlockStack gap="400">
              <div className="sf-section-header">
                <Text as="h2" variant="headingMd">{t("themeWidget.configTitle")}</Text>
              </div>
              <FormLayout>
                <TextField
                  label={t("themeWidget.headingLabel")}
                  name="heading"
                  value={heading}
                  onChange={setHeading}
                  helpText={t("themeWidget.headingHelp")}
                  autoComplete="off"
                  requiredIndicator
                />
                <Select
                  label={t("themeWidget.productCount")}
                  name="productCount"
                  value={productCount}
                  onChange={setProductCount}
                  options={[
                    { label: t("themeWidget.products", { count: "2" }), value: "2" },
                    { label: t("themeWidget.products", { count: "4" }), value: "4" },
                    { label: t("themeWidget.products", { count: "6" }), value: "6" },
                    { label: t("themeWidget.products", { count: "8" }), value: "8" },
                    { label: t("themeWidget.products", { count: "12" }), value: "12" },
                  ]}
                  helpText={t("themeWidget.productCountHelp")}
                />
              </FormLayout>
              <div style={{ borderTop: "1px solid #e1e3e5", paddingTop: "16px" }}>
                <Button submit variant="primary" icon={CheckIcon}>
                  {t("themeWidget.saveConfig")}
                </Button>
              </div>
            </BlockStack>
          </Form>
        </Card>

        {/* Feedback banners */}
        {actionData && "success" in actionData && actionData.success && (
          <Banner tone="success" title={actionData.message || t("themeWidget.saved")} />
        )}
        {actionData && "error" in actionData && actionData.error && (
          <Banner tone="critical" title={actionData.error} />
        )}
      </BlockStack>
    </Page>
  );
}
