/**
 * File: landing/components/PricingSection.tsx
 * Author: yuntongsoft
 * Date: 2026/08/29
 * Pricing section — boilerplate license tiers
 * Replace LemonSqueezy links with your actual payment provider
 */
const plans = [
  {
    name: "Solo",
    price: "$99",
    description: "For individual developers building one app",
    features: [
      "Full source code access",
      "All modules included",
      "Free updates for 1 year",
      "Use in 1 commercial app",
    ],
    cta: "Buy Now",
    highlighted: false,
  },
  {
    name: "Team",
    price: "$249",
    description: "For teams building multiple apps",
    features: [
      "Everything in Solo",
      "Use in up to 5 apps",
      "Priority support",
      "Private GitHub repo access",
      "Custom module requests",
    ],
    cta: "Buy Now",
    highlighted: true,
  },
  {
    name: "Enterprise",
    price: "Contact",
    description: "For agencies and large organizations",
    features: [
      "Everything in Team",
      "Unlimited apps",
      "Dedicated support channel",
      "Custom onboarding",
      "SLA guarantee",
    ],
    cta: "Contact Us",
    highlighted: false,
  },
];

export default function PricingSection() {
  return (
    <section id="pricing" className="py-24">
      <div className="mx-auto max-w-5xl px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight">Simple Pricing</h2>
        <p className="mt-4 text-center text-lg text-gray-600">
          One-time purchase. No subscriptions. Build your app and keep the revenue.
        </p>
        <div className="mt-16 grid gap-8 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-8 ${
                plan.highlighted
                  ? "border-shopify-green shadow-lg scale-105"
                  : "border-gray-200"
              }`}
            >
              <h3 className="text-xl font-bold">{plan.name}</h3>
              <p className="mt-2 text-sm text-gray-600">{plan.description}</p>
              <p className="mt-6 text-4xl font-bold">
                {plan.price}
                {plan.price !== "Contact" && (
                  <span className="text-base font-normal text-gray-500"> one-time</span>
                )}
              </p>
              <ul className="mt-8 space-y-3">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm">
                    <span className="text-shopify-green mt-0.5">&#10003;</span>
                    {f}
                  </li>
                ))}
              </ul>
              <a
                href="https://github.com/your-org/shopforge#purchase"
                className={`mt-8 block rounded-lg px-6 py-3 text-center text-sm font-semibold transition ${
                  plan.highlighted
                    ? "bg-shopify-green text-white hover:bg-green-700"
                    : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                }`}
              >
                {plan.cta}
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
