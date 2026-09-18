/**
 * File: landing/components/Hero.tsx
 * Author: yuntongsoft
 * Date: 2026/08/27
 * Hero section — first impression, value proposition
 */
export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-shopify-dark to-gray-900 text-white">
      <div className="mx-auto max-w-5xl px-6 py-24 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          Ship Your Shopify App{" "}
          <span className="text-shopify-green">in Days, Not Months</span>
        </h1>
        <p className="mt-6 text-lg leading-8 text-gray-300">
          Production-ready boilerplate with OAuth, Billing, Functions, GDPR compliance,
          i18n, and cold-start self-healing. Stop reinventing — start building.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <a
            href="#pricing"
            className="rounded-lg bg-shopify-green px-8 py-3 text-base font-semibold text-white shadow-sm hover:bg-green-700 transition"
          >
            Get Started
          </a>
          <a
            href="#features"
            className="rounded-lg border border-white/20 px-8 py-3 text-base font-semibold text-white hover:bg-white/10 transition"
          >
            See Features
          </a>
        </div>
        <p className="mt-6 text-sm text-gray-400">
          Open source — MIT License. Build your app and keep the revenue.
        </p>
      </div>
    </section>
  );
}
