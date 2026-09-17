/**
 * File: landing/app/page.tsx
 * Author: yuntongsoft
 * Date: 2026/08/30
 * Landing page — composes Hero, Features, Testimonials, Pricing, FAQ, CTA, Footer
 * This is the public marketing page for ShopForge
 */
import Hero from "@/components/Hero";
import Features from "@/components/Features";
import Testimonials from "@/components/Testimonials";
import PricingSection from "@/components/PricingSection";
import FAQ from "@/components/FAQ";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";

export default function HomePage() {
  return (
    <main>
      <Hero />
      <Features />
      <Testimonials />
      <PricingSection />
      <FAQ />
      <CTA />
      <Footer />
    </main>
  );
}
