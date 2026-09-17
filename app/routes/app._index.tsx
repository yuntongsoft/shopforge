/**
 * File: routes/app._index.tsx
 * Author: yuntongsoft
 * Date: 2026/08/25
 * Purpose: Dashboard — the first page merchants see after install
 *
 * Displays real business data:
 *   - Recent orders count (30 days)
 *   - Revenue (30 days)
 *   - Active discounts count
 *   - Deployed Functions count
 *   - Quick action cards for key operations
 *
 * Dependencies: shopifyAdmin, shopify-auth, Polaris
 */
import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useRouteLoaderData } from "@remix-run/react";
import { Page, Text, BlockStack, Icon } from "@shopify/polaris";
import {
  OrderIcon,
  MoneyNoneIcon,
  DiscountIcon,
  CodeIcon,
  CalendarIcon,
  PaintBrushRoundIcon,
  ReceiptDollarIcon,
  ArrowRightIcon,
} from "@shopify/polaris-icons";
import { authenticatePage } from "~/utils/shopify-auth.server";
import { shopifyAdmin } from "~/services/shopify-admin";
import { createLogger } from "~/utils/logger";
import { useTranslation } from "~/utils/i18n";

const logger = createLogger({ module: "dashboard" });

// ─────────────────────────────────────────────────────────────────────────────
// LOADER — Fetch dashboard stats from Shopify Admin API
// ─────────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticatePage(request);
  if (!auth.ok) return auth.response;
  const shop = auth.shop;

  try {
    const api = shopifyAdmin(shop.shopifyDomain);
    const [shopInfo, orderStats, discountCount] = await Promise.allSettled([
      api.getShopInfo(),
      api.getOrderStats(30),
      api.graphql<{ automaticDiscountNodes: { edges: unknown[] }; discountNodes: { edges: unknown[] } }>(`
        query {
          automaticDiscountNodes(first: 1) { edges { node { id } } }
          discountNodes(first: 1) { edges { node { id } } }
        }
      `).then((d) => (d.automaticDiscountNodes?.edges?.length ?? 0) + (d.discountNodes?.edges?.length ?? 0)),
    ]);

    const shopInfoValue = shopInfo.status === "fulfilled" ? shopInfo.value : {} as Record<string, unknown>;
    const orderStatsValue = orderStats.status === "fulfilled" ? orderStats.value : { totalOrders: 0, totalRevenue: 0 };
    const discounts = discountCount.status === "fulfilled" ? discountCount.value : 0;

    // Log which API calls failed (server-side only, not exposed to client)
    if (shopInfo.status === "rejected") logger.warn({ error: shopInfo.reason?.message }, "getShopInfo failed");
    if (orderStats.status === "rejected") logger.warn({ error: orderStats.reason?.message }, "getOrderStats failed");
    if (discountCount.status === "rejected") logger.warn({ error: discountCount.reason?.message }, "discountCount failed");

    logger.info({
      shop: shop.shopifyDomain,
      orders: orderStatsValue.totalOrders,
      revenue: orderStatsValue.totalRevenue,
      discounts,
      shopInfoOk: shopInfo.status === "fulfilled",
      orderStatsOk: orderStats.status === "fulfilled",
    }, "Dashboard loaded");

    return json({
      shopName: (shopInfoValue as Record<string, unknown>)?.name as string || shop.shopifyDomain,
      plan: shop.plan || "\u2014",
      currency: (shopInfoValue as Record<string, unknown>)?.currency as string || "USD",
      totalOrders: orderStatsValue.totalOrders,
      totalRevenue: orderStatsValue.totalRevenue,
      activeDiscounts: discounts,
      functionCount: 0, // TODO: implement function count query
    });
  } catch (err) {
    logger.error({ error: (err as Error)?.message }, "Dashboard API calls threw exception");
    // Return basic data rather than failing — dashboard should always render
    return json({
      shopName: shop.shopifyDomain,
      plan: shop.plan || "\u2014",
      currency: "USD",
      totalOrders: 0,
      totalRevenue: 0,
      activeDiscounts: 0,
      functionCount: 0,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const { shopName, plan, currency, totalOrders, totalRevenue, activeDiscounts, functionCount } =
    useLoaderData<typeof loader>();
  const { t } = useTranslation(useRouteLoaderData<typeof import("./app").loader>("routes/app")?.locale);

  const currencySymbol = currency === "USD" ? "$" : currency;

  return (
    <Page title={`${t("dashboard.welcomeTo")} ${shopName}`}>
      <BlockStack gap="600">
        {/* ── Stats Row ──────────────────────────────────────── */}
        <div className="sf-stat-grid">
          <StatCard
            icon={OrderIcon}
            color="blue"
            label={t("dashboard.orders30d")}
            value={String(totalOrders)}
          />
          <StatCard
            icon={MoneyNoneIcon}
            color="green"
            label={t("dashboard.revenue30d")}
            value={`${currencySymbol}${totalRevenue.toLocaleString()}`}
          />
          <StatCard
            icon={DiscountIcon}
            color="purple"
            label={t("dashboard.activeDiscounts")}
            value={String(activeDiscounts)}
          />
          <StatCard
            icon={CodeIcon}
            color="orange"
            label={t("dashboard.functions")}
            value={String(functionCount)}
          />
        </div>

        {/* ── Quick Actions ──────────────────────────────────── */}
        <div>
          <div className="sf-section-header">
            <Icon source={PaintBrushRoundIcon} tone="base" />
            <Text as="h2" variant="headingMd">{t("dashboard.quickActions")}</Text>
          </div>
          <div className="sf-actions-grid">
            <QuickAction
              icon={DiscountIcon}
              title={t("dashboard.actionDiscountsTitle")}
              description={t("dashboard.actionDiscountsDesc")}
              href="/app/discounts"
            />
            <QuickAction
              icon={PaintBrushRoundIcon}
              title={t("dashboard.actionWidgetTitle")}
              description={t("dashboard.actionWidgetDesc")}
              href="/app/theme-widget"
            />
            <QuickAction
              icon={ReceiptDollarIcon}
              title={t("dashboard.actionPricingTitle")}
              description={t("dashboard.actionPricingDesc")}
              href="/app/pricing"
            />
          </div>
        </div>

        {/* ── Plan Info ──────────────────────────────────────── */}
        <div className="sf-plan-bar">
          <Icon source={CalendarIcon} tone="base" />
          <Text as="span" variant="bodyMd">
            {t("dashboard.planInfo", { plan })}
          </Text>
        </div>
      </BlockStack>
    </Page>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatCard — metric display with icon
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({
  icon,
  color,
  label,
  value,
}: {
  icon: React.FC<any> | string;
  color: "blue" | "green" | "purple" | "orange";
  label: string;
  value: string;
}) {
  return (
    <div className="sf-stat-card">
      <div className={`sf-stat-icon sf-stat-icon--${color}`}>
        <Icon source={icon} tone="base" />
      </div>
      <div className="sf-stat-content">
        <span className="sf-stat-label">{label}</span>
        <span className="sf-stat-value">{value}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QuickAction — navigation card
// ─────────────────────────────────────────────────────────────────────────────
function QuickAction({
  icon,
  title,
  description,
  href,
}: {
  icon: React.FC<any> | string;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a className="sf-action-card" href={href}>
      <div className="sf-action-icon">
        <Icon source={icon} tone="base" />
      </div>
      <div className="sf-action-text">
        <span className="sf-action-title">{title}</span>
        <span className="sf-action-desc">{description}</span>
      </div>
    </a>
  );
}
