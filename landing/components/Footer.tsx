/**
 * File: landing/components/Footer.tsx
 * Author: yuntongsoft
 * Date: 2026/08/29
 * Footer — minimal with links and copyright
 */
import { siteConfig } from "@/lib/site-config";

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50 py-12">
      <div className="mx-auto max-w-5xl px-6">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="text-xl font-bold text-shopify-green">{siteConfig.name}</span>
            <span className="text-sm text-gray-500">{siteConfig.tagline}</span>
          </div>
          <nav className="flex gap-6 text-sm text-gray-600">
            <a href="#features" className="hover:text-gray-900 transition">Features</a>
            <a href="#pricing" className="hover:text-gray-900 transition">Pricing</a>
            <a href="https://github.com/your-org/shopforge/blob/main/GETTING-STARTED.md" target="_blank" rel="noopener noreferrer" className="hover:text-gray-900 transition">Docs</a>
            <a href={`mailto:${siteConfig.social.email}`} className="hover:text-gray-900 transition">Support</a>
          </nav>
        </div>
        <p className="mt-8 text-center text-sm text-gray-400">
          &copy; {new Date().getFullYear()} {siteConfig.name}. Not affiliated with Shopify Inc.
        </p>
      </div>
    </footer>
  );
}
