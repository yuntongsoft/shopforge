/**
 * File: landing/components/Testimonials.tsx
 * Author: yuntongsoft
 * Date: 2026/08/28
 * Testimonials — Social proof section.
 *
 * IMPORTANT: Replace these with real customer testimonials as you get them.
 * The examples below are placeholders to show the intended layout.
 * Using fake testimonials in production is unethical and potentially illegal.
 */

const testimonials = [
  {
    quote:
      "ShopForge saved us weeks of boilerplate work. The Function templates and billing integration were exactly what we needed to focus on our core product.",
    name: "Developer Review",
    role: "Shopify App Developer",
    avatar: "DR",
    isPlaceholder: true,
  },
  {
    quote:
      "The GDPR compliance webhooks and encrypted token storage gave us confidence that we'd pass App Store review. We did on the first submission.",
    name: "Early Adopter",
    role: "Indie Shopify Developer",
    avatar: "EA",
    isPlaceholder: true,
  },
  {
    quote:
      "The three-layer discount abstraction is brilliant. Our developers create discounts with business parameters and never need to understand Function internals.",
    name: "Team Lead",
    role: "Shopify Plus Agency",
    avatar: "TL",
    isPlaceholder: true,
  },
];

export default function Testimonials() {
  return (
    <section className="py-20 bg-gray-50">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
          What Developers Are Saying
        </h2>
        <p className="text-center text-gray-600 mb-12 max-w-2xl mx-auto">
          ShopForge is used by developers building production Shopify apps.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {testimonials.map((t, index) => (
            <div
              key={index}
              className="bg-white rounded-2xl p-8 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
            >
              {/* Star rating */}
              <div className="flex gap-1 mb-4">
                {[...Array(5)].map((_, i) => (
                  <svg key={i} className="w-5 h-5 text-yellow-400 fill-current" viewBox="0 0 20 20">
                    <path d="M10 15l-5.878 3.09 1.123-6.545L.489 6.91l6.572-.955L10 0l2.939 5.955 6.572.955-4.756 4.635 1.123 6.545z" />
                  </svg>
                ))}
              </div>

              {/* Quote */}
              <p className="text-gray-700 leading-relaxed mb-6">&ldquo;{t.quote}&rdquo;</p>

              {/* Author */}
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center font-semibold text-sm">
                  {t.avatar}
                </div>
                <div>
                  <p className="font-semibold text-gray-900 text-sm">{t.name}</p>
                  <p className="text-gray-500 text-sm">{t.role}</p>
                </div>
              </div>

              {/* Placeholder indicator */}
              {t.isPlaceholder && (
                <p className="text-xs text-gray-400 mt-3 italic">
                  Example testimonial — replace with real customer feedback
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
