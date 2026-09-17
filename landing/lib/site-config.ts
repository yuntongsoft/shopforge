/**
 * File: landing/lib/site-config.ts
 * Author: yuntongsoft
 * Date: 2026/08/26
 * Site configuration — single source of truth for branding.
 *
 * To rebrand the landing page, edit this file. All components import from here.
 * No need to search-and-replace across multiple files.
 */

export const siteConfig = {
  /** Brand name — displayed in footer, SEO title suffix, OG site name */
  name: "ShopForge",

  /** Short tagline — displayed in footer next to brand name */
  tagline: "Shopify App Starter Kit",

  /** Full description — used in SEO meta description and OG description */
  description:
    "Production-ready Shopify app boilerplate with OAuth, Billing, Functions, GDPR compliance, and more. Ship your app in days, not months.",

  /** Base URL — set via NEXT_PUBLIC_SITE_URL env var, falls back to placeholder */
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://shopforge.dev",

  /** Default OG image path (relative to base URL) */
  ogImage: "/og-image.svg",

  /** SEO keywords */
  keywords: [
    "Shopify app",
    "Shopify boilerplate",
    "Shopify starter kit",
    "Shopify Functions",
    "Remix",
    "Polaris",
    "SaaS template",
  ],

  /** Social links */
  social: {
    github: "https://github.com/your-org/shopforge",
    twitter: "@shopforge",
    email: "support@example.com",
  },
} as const;
