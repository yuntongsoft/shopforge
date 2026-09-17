/**
 * File: demo/routes/pricing.tsx
 * Author: yuntongsoft
 * Date: 2026/09/10
 * Purpose: [DEMO] Pricing page — three-tier subscription cards (Free/Pro/Business)
 *          with working upgrade flow via Shopify Billing API.
 *
 * ============================================================================
 * DEMO COMPONENT — Pure React UI, no server-only imports
 * Server logic (loader/action) lives in routes/app.pricing.tsx
 * ============================================================================
 *
 * Dependencies: @shopify/polaris, @remix-run/react, i18n
 */
import {
  Page,
  Layout,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Banner,
  Icon,
  Button,
  Divider,
  InlineGrid,
} from "@shopify/polaris";
import { CheckIcon } from "@shopify/polaris-icons";
import { useLoaderData, useRouteLoaderData } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useState } from "react";
import { useTranslation } from "~/utils/i18n";

// ─────────────────────────────────────────────────────────────────────────────
// Types (must match wrapper loader response shape)
// ─────────────────────────────────────────────────────────────────────────────
interface PricingPlan {
  name: string;
  description: string;
  price: number;
  interval: string;
  trialDays: number;
}

interface PricingLoaderData {
  currentPlan: string;
  plans: Record<string, PricingPlan>;
  shopDomain: string;
  csrfToken: string;
}

interface PricingActionData {
  confirmationUrl?: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature keys per plan (used to render feature lists)
// ─────────────────────────────────────────────────────────────────────────────
const PLAN_FEATURES: Record<string, string[]> = {
  free: ["featureDiscounts", "featureWidget"],
  pro: ["featureDiscounts", "featureWidget", "featurePriority", "featureAnalytics"],
  business: ["featureDiscounts", "featureWidget", "featurePriority", "featureAnalytics", "featureCustom", "featureApi"],
};

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────
export default function PricingPage() {
  const { currentPlan, plans, shopDomain, csrfToken } = useLoaderData<PricingLoaderData>();
  const shopify = useAppBridge();
  const { t } = useTranslation(useRouteLoaderData<typeof import("~/routes/app").loader>("routes/app")?.locale);
  const [redirecting, setRedirecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleUpgrade = async (planKey: string) => {
    setRedirecting(true);
    setErrorMessage(null);
    try {
      const token = await shopify.idToken();
      const formData = new FormData();
      formData.append("plan", planKey);
      formData.append("csrfToken", csrfToken);

      const res = await fetch(`/app/pricing?id_token=${encodeURIComponent(token)}`, {
        method: "POST",
        body: formData,
      });

      // Remix returns SSR HTML — extract actionData from embedded __remixContext
      const html = await res.text();
      const match = html.match(/window\.__remixContext\s*=\s*({.+?})\s*;?\s*<\/script>/s);
      if (match) {
        try {
          const ctx = JSON.parse(match[1]);
          const actionData = ctx?.state?.actionData?.["routes/app.pricing"] as PricingActionData | undefined;
          if (actionData?.confirmationUrl) {
            window.open(actionData.confirmationUrl, "_top");
          } else if (actionData?.error) {
            setErrorMessage(actionData.error);
            setRedirecting(false);
          } else {
            setRedirecting(false);
          }
        } catch {
          setErrorMessage("Unexpected response. Please try again.");
          setRedirecting(false);
        }
      } else {
        setErrorMessage("Unexpected response. Please try again.");
        setRedirecting(false);
      }
    } catch {
      setErrorMessage("Network error. Please try again.");
      setRedirecting(false);
    }
  };

  const planOrder = ["free", "pro", "business"];

  return (
    <Page
      title={t("pricing.title")}
      subtitle={`${t("pricing.shopLabel")}: ${shopDomain}`}
      backAction={{ content: t("pricing.backToDashboard"), url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Error banner */}
            {errorMessage && (
              <Banner tone="critical" title={errorMessage} onDismiss={() => setErrorMessage(null)} />
            )}

            {/* Pricing cards grid — uses Polaris InlineGrid for responsive layout */}
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              {planOrder.map((key) => {
                const plan = plans[key];
                if (!plan) return null;

                const isCurrentPlan = currentPlan === key;
                const isFreePlan = plan.price === 0;
                const isFeatured = key === "pro";
                const features = PLAN_FEATURES[key] || [];

                return (
                  <PricingCard
                    key={key}
                    planKey={key}
                    name={plan.name}
                    description={t(`pricing.${key}Desc`)}
                    price={isFreePlan ? t("pricing.freeForever") : `$${plan.price}`}
                    period={!isFreePlan ? t("pricing.perMonth") : undefined}
                    features={features}
                    cta={
                      isCurrentPlan
                        ? t("pricing.currentPlanLabel")
                        : isFreePlan
                          ? t("pricing.currentPlanLabel")
                          : t("pricing.upgradeTo", { plan: plan.name })
                    }
                    ctaDisabled={isCurrentPlan || isFreePlan || redirecting}
                    ctaVariant={isFeatured ? "primary" : "secondary"}
                    highlighted={isFeatured}
                    currentBadge={isCurrentPlan}
                    onUpgrade={() => handleUpgrade(key)}
                    t={t}
                  />
                );
              })}
            </InlineGrid>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

/**
 * Pricing card component — uses flex layout for equal height alignment
 */
function PricingCard({
  planKey,
  name,
  description,
  price,
  period,
  features,
  cta,
  ctaDisabled,
  ctaVariant,
  highlighted,
  currentBadge,
  onUpgrade,
  t,
}: {
  planKey: string;
  name: string;
  description: string;
  price: string;
  period?: string;
  features: string[];
  cta: string;
  ctaDisabled?: boolean;
  ctaVariant?: "primary" | "secondary";
  highlighted?: boolean;
  currentBadge?: boolean;
  onUpgrade?: () => void;
  t: (key: string, vars?: Record<string, string>) => string;
}) {
  return (
    <div
      className={`sf-pricing-card${highlighted ? " sf-pricing-card--featured" : ""}`}
    >
      {/* Popular ribbon */}
      {highlighted && !currentBadge && (
        <div className="sf-pricing-ribbon">{t("pricing.mostPopular")}</div>
      )}

      {/* Header: name + current plan badge */}
      <InlineStack align="space-between" blockAlign="center">
        <Text as="h3" variant="headingMd" fontWeight="bold">
          {name}
        </Text>
        {currentBadge && (
          <Badge tone="success">{t("pricing.currentPlanBadge")}</Badge>
        )}
      </InlineStack>

      {/* Price */}
      <div className="sf-pricing-price">
        <Text as="span" variant="heading2xl" fontWeight="bold">
          {price}
        </Text>
        {period && (
          <Text as="span" variant="bodySm" tone="subdued">
            / {period}
          </Text>
        )}
      </div>

      {/* Description */}
      <Text as="p" variant="bodySm" tone="subdued">
        {description}
      </Text>

      <Divider />

      {/* Features — flex: 1 pushes button to bottom */}
      <div style={{ flex: 1 }}>
        <BlockStack gap="300">
          {features.map((featKey) => (
            <InlineStack key={featKey} gap="200" blockAlign="center">
              <div className="sf-pricing-check">
                <span><Icon source={CheckIcon} /></span>
              </div>
              <Text as="span" variant="bodySm">
                {t(`pricing.${featKey}`)}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      </div>

      {/* CTA Button — always at bottom */}
      <Button
        variant={ctaVariant || "secondary"}
        fullWidth
        disabled={ctaDisabled}
        onClick={onUpgrade}
      >
        {cta}
      </Button>
    </div>
  );
}
