/**
 * File: landing/components/SEO.ts
 * Author: yuntongsoft
 * Date: 2026/08/30
 * SEO — Reusable metadata generator for blog posts and pages.
 * Produces Open Graph, Twitter Card, and canonical URL metadata objects
 * for use with Next.js App Router's generateMetadata().
 *
 * Usage:
 *   export function generateMetadata(): Metadata {
 *     return getSEOMetadata({ title: "My Post", description: "...", path: "/blog/my-post" });
 *   }
 */

import { siteConfig } from "@/lib/site-config";

interface SEOProps {
  title: string;
  description: string;
  path?: string;
  image?: string;
  type?: "website" | "article";
  publishedTime?: string;
  author?: string;
}

/**
 * Generate Next.js App Router metadata object for use in generateMetadata().
 *
 * @param title - Page title (will be suffixed with site name)
 * @param description - Page description for SEO
 * @param path - URL path (e.g. "/blog/my-post")
 * @param image - OG image URL (defaults to siteConfig.ogImage)
 * @param type - OG type ("website" or "article")
 * @param publishedTime - Article publish date (ISO string)
 * @param author - Article author name
 */
export function getSEOMetadata({
  title,
  description,
  path = "",
  image,
  type = "website",
  publishedTime,
  author,
}: SEOProps) {
  const url = `${siteConfig.url}${path}`;
  const ogImage = image || `${siteConfig.url}${siteConfig.ogImage}`;

  return {
    title: `${title} — ${siteConfig.name}`,
    description,
    canonical: url,
    openGraph: {
      title,
      description,
      url,
      siteName: siteConfig.name,
      type,
      images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      ...(publishedTime && { publishedTime }),
      ...(author && { authors: [author] }),
    },
    twitter: {
      card: "summary_large_image" as const,
      title,
      description,
      images: [ogImage],
    },
    robots: {
      index: true,
      follow: true,
    },
  };
}
