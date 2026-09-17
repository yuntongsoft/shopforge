/**
 * File: landing/components/FAQ.tsx
 * Author: yuntongsoft
 * Date: 2026/08/28
 * FAQ — Frequently Asked Questions accordion section.
 * Answers common buyer concerns to reduce friction before purchase.
 */
"use client";

import { useState } from "react";

const faqs = [
  {
    question: "What tech stack does ShopForge use?",
    answer:
      "ShopForge is built with Remix 2.x, Polaris 12, Prisma 5 (PostgreSQL), and Shopify App Bridge 4. The landing page uses Next.js 14 with Tailwind CSS. Shopify Functions are available in both Rust and JavaScript.",
  },
  {
    question: "Do I need to know Rust to use Shopify Functions?",
    answer:
      "No. ShopForge includes JavaScript Function templates that work without Rust. Just edit the run.js file and deploy. Rust templates are also available for performance-critical use cases.",
  },
  {
    question: "Will this pass Shopify App Store review?",
    answer:
      "Yes. ShopForge was extracted from a real app that passed App Store review. It includes GDPR compliance webhooks, Privacy Policy and Terms pages, proper OAuth flow, and billing integration — all required by Shopify.",
  },
  {
    question: "How is this different from the official Shopify CLI template?",
    answer:
      "The official template gives you a bare minimum Express app. ShopForge adds production-ready infrastructure: encrypted token storage, rate limiting, retry logic, i18n (4 languages), a code generator, 6 Function templates, Theme Extension support, unit tests, and a polished landing page.",
  },
  {
    question: "Can I use this for multiple client projects?",
    answer:
      "Yes. ShopForge is MIT licensed — use it for unlimited projects, commercial or personal. No attribution required. Each project gets its own copy of the codebase to customize freely.",
  },
  {
    question: "What if I get stuck or need help?",
    answer:
      "Every file includes detailed header comments explaining its purpose, dependencies, and usage. The codebase is designed to be AI-friendly — tools like Cursor and Claude can understand the context immediately. We also maintain a GitHub repository with issues and discussions.",
  },
];

export default function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="py-20 bg-white">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">
          Frequently Asked Questions
        </h2>
        <p className="text-center text-gray-600 mb-12">
          Everything you need to know before getting started.
        </p>

        <div className="space-y-3">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="border border-gray-200 rounded-xl overflow-hidden"
            >
              <button
                onClick={() => toggle(index)}
                className="w-full px-6 py-4 text-left flex items-center justify-between hover:bg-gray-50 transition-colors"
                aria-expanded={openIndex === index}
              >
                <span className="font-semibold text-gray-900">{faq.question}</span>
                <svg
                  className={`w-5 h-5 text-gray-500 transform transition-transform ${
                    openIndex === index ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {openIndex === index && (
                <div className="px-6 pb-4 text-gray-600 leading-relaxed">
                  {faq.answer}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
