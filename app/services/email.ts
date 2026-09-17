/**
 * File: services/email.ts
 * Author: yuntongsoft
 * Date: 2026/09/05
 * Purpose: Transactional email service powered by Resend — welcome emails, billing notifications, etc.
 *
 * Dependencies: resend
 * Used by: billing.service.ts (billing events), auth routes (welcome email), cron jobs (notifications)
 *
 * Usage:
 *   import { sendWelcomeEmail, sendBillingEmail } from "~/services/email";
 *   await sendWelcomeEmail("example.myshopify.com", "merchant@example.com");
 *
 * Dev mode: When RESEND_API_KEY is not set, emails are logged but NOT sent (safe for local dev).
 */
import { createLogger } from "~/utils/logger";
import { getErrorMessage } from "~/utils/errors";
import { escapeHtml } from "~/utils/sanitize";
import { getTranslation } from "~/utils/i18n";

const logger = createLogger({ module: "email" });

/**
 * Resend client — lazy-initialized via dynamic import() to avoid ESM compatibility issues.
 * In production, RESEND_API_KEY must be set. In development, emails are mocked via log.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resendClient: any = null;

async function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;

  if (!resendClient) {
    // Dynamic import for ESM compatibility (require() doesn't work in "type": "module")
    const { Resend } = await import("resend");
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/**
 * Sender email address — must be a verified domain in Resend dashboard.
 * Defaults to onboarding@resend.dev for testing; override with RESEND_FROM_EMAIL env var.
 */
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "ShopForge <onboarding@resend.dev>";

/**
 * Send a generic transactional email.
 *
 * @param to - Recipient email address
 * @param subject - Email subject line
 * @param html - HTML body content
 * @returns Resend response or null if in mock mode
 */
export async function sendEmail(
  to: string,
  subject: string,
  html: string
): Promise<{ id: string } | null> {
  const client = await getResendClient();

  if (!client) {
    // Dev/mock mode: log but don't send
    logger.info({ to, subject }, "[email:mock] Would send email (RESEND_API_KEY not set)");
    return null;
  }

  try {
    const result = await client.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });
    logger.info({ to, subject, emailId: (result as { id: string }).id }, "Email sent successfully");
    return result as { id: string };
  } catch (error) {
    // Email failure should not crash the app — log and continue
    logger.error({ to, subject, error: getErrorMessage(error) }, "Failed to send email");
    return null;
  }
}

/**
 * Send a welcome email to a newly installed shop.
 *
 * @param shopDomain - Shopify shop domain (e.g. "example.myshopify.com")
 * @param merchantEmail - Merchant's email address (from Shopify OAuth or manual input)
 */
export async function sendWelcomeEmail(shopDomain: string, merchantEmail: string, locale?: string): Promise<void> {
  const { t } = getTranslation(locale);
  const safeDomain = escapeHtml(shopDomain);
  const shopUrl = `https://${shopDomain}/admin/apps`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #008060;">${escapeHtml(t("email.welcome_title") || "Welcome to ShopForge!")}</h1>
      <p>${escapeHtml(t("email.welcome_intro") || "Thanks for installing ShopForge on")} <strong>${safeDomain}</strong>.</p>
      <p>${escapeHtml(t("email.welcome_cta") || "You're all set to start building your Shopify app.")}</p>
      <ul>
        <li>${escapeHtml(t("email.welcome_step1") || "Configure your app settings in the")} <a href="${shopUrl}">Shopify Admin</a></li>
        <li>${escapeHtml(t("email.welcome_step2") || "Check out our")} <a href="https://github.com/your-org/shopforge#day-1-developer-guide">Developer Guide</a></li>
        <li>${escapeHtml(t("email.welcome_step3") || "Explore the built-in Function templates")}</li>
      </ul>
      <p>${escapeHtml(t("email.welcome_support") || "If you have any questions, just reply to this email — we're here to help.")}</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #666; font-size: 14px;">${escapeHtml(t("email.footer") || "Built with ShopForge — the production-ready Shopify App starter kit.")}</p>
    </div>
  `;

  await sendEmail(merchantEmail, t("email.welcome_subject") || "Welcome to ShopForge — let's get started!", html);
}

/**
 * Send a billing notification email (subscription confirmed, plan changed, etc.).
 *
 * @param shopDomain - Shopify shop domain
 * @param merchantEmail - Merchant's email address
 * @param planName - Plan name (e.g. "Pro", "Business")
 * @param action - What happened (e.g. "upgraded", "downgraded", "confirmed")
 */
export async function sendBillingEmail(
  shopDomain: string,
  merchantEmail: string,
  planName: string,
  action: "confirmed" | "upgraded" | "downgraded" | "cancelled" = "confirmed",
  locale?: string
): Promise<void> {
  const { t } = getTranslation(locale);
  const safeDomain = escapeHtml(shopDomain);
  const safePlan = escapeHtml(planName);

  const actionCopy: Record<string, string> = {
    confirmed: t("email.billing_confirmed") || `Your ${safePlan} plan is now active.`,
    upgraded: t("email.billing_upgraded") || `You've upgraded to the ${safePlan} plan.`,
    downgraded: t("email.billing_downgraded") || `Your plan has been changed to ${safePlan}.`,
    cancelled: t("email.billing_cancelled") || `Your subscription has been cancelled. You can re-subscribe anytime.`,
  };

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="color: #008060;">${escapeHtml(t("email.billing_title") || "Subscription Update")}</h1>
      <p>${escapeHtml(t("email.billing_greeting") || "Hi there,")}</p>
      <p>${escapeHtml(actionCopy[action])}</p>
      <p><strong>${escapeHtml(t("email.billing_shop") || "Shop")}</strong> ${safeDomain}<br /><strong>${escapeHtml(t("email.billing_plan") || "Plan")}</strong> ${safePlan}</p>
      <p>${escapeHtml(t("email.billing_manage") || "You can manage your subscription anytime from your")} <a href="https://${shopDomain}/admin/apps">Shopify Admin</a>.</p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
      <p style="color: #666; font-size: 14px;">${escapeHtml(t("email.billing_support") || "Questions? Just reply to this email.")}</p>
    </div>
  `;

  await sendEmail(merchantEmail, `${escapeHtml(t("email.billing_subject") || "ShopForge Subscription")} ${action}`, html);
}
