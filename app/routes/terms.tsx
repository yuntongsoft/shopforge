/**
 * File: routes/terms.tsx
 * Author: yuntongsoft
 * Date: 2026/09/06
 * Purpose: Public terms of service page — recommended for Shopify App Store listing
 *
 * This page is publicly accessible (no Shopify auth required).
 * Uses Remix layout system (no duplicate <html> tags).
 * Replace placeholder values with your actual app information.
 *
 * URL: https://shopforge.dev/terms
 */
export default function PublicTerms() {
  return (
    <div style={{
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
      background: "#f6f6f7",
      color: "#202223",
      lineHeight: 1.7,
      minHeight: "100vh",
    }}>
      <div style={{
        background: "#008060",
        color: "#fff",
        padding: "32px 24px",
        textAlign: "center",
        marginBottom: 32,
        borderRadius: "0 0 12px 12px",
      }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Terms of Service</h1>
        <p style={{ fontSize: 14, opacity: 0.85 }}>ShopForge for Shopify</p>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px 40px" }}>
        <p style={{ fontSize: 13, color: "#6d7175", marginBottom: 24 }}>Last updated: 2026-01-01</p>

        <LegalCard title="1. Acceptance of Terms">
          <p>By installing or using ShopForge (&quot;the App&quot;), you agree to these Terms of Service. If you do not agree, please uninstall the App immediately.</p>
        </LegalCard>

        <LegalCard title="2. Description of Service">
          <p>ShopForge provides a production-ready Shopify App boilerplate with discount management, billing integration, and storefront widget capabilities as described in the app listing.</p>
        </LegalCard>

        <LegalCard title="3. Subscription & Billing">
          <p>The App offers the following plans:</p>
          <ul>
            <li><strong>Free:</strong> Core features with basic discount types.</li>
            <li><strong>Pro ($9.99/month):</strong> Advanced discount types with 7-day free trial.</li>
            <li><strong>Business ($29.99/month):</strong> Full feature access with 7-day free trial.</li>
          </ul>
          <p>Subscriptions are billed through Shopify&apos;s Billing API. You can cancel at any time from your Shopify admin. Upon cancellation, you retain access until the end of your billing period.</p>
        </LegalCard>

        <LegalCard title="4. Limitation of Liability">
          <p>The App is provided &quot;as is&quot; without warranty of any kind. We are not liable for any indirect, incidental, or consequential damages arising from the use of the App.</p>
        </LegalCard>

        <LegalCard title="5. Termination">
          <p>We reserve the right to suspend or terminate access to the App for violation of these terms. Upon termination, all associated data will be deleted within 30 days via the GDPR-compliant SHOP_REDACT webhook handler.</p>
        </LegalCard>

        <LegalCard title="6. Changes to Terms">
          <p>We may update these Terms from time to time. Continued use of the App after changes constitutes acceptance of the updated Terms.</p>
        </LegalCard>

        <LegalCard title="7. Contact">
          <p>For questions about these Terms, please contact us through the Shopify App Store listing.</p>
        </LegalCard>
      </div>

      <div style={{ textAlign: "center", padding: 24, fontSize: 13, color: "#6d7175" }}>
        ShopForge Team
      </div>
    </div>
  );
}

function LegalCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: "#fff",
      borderRadius: 12,
      boxShadow: "0 1px 6px rgba(0,0,0,0.06)",
      padding: 32,
      marginBottom: 20,
    }}>
      <h2 style={{
        fontSize: 18,
        fontWeight: 600,
        color: "#202223",
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: "1px solid #e1e3e5",
      }}>{title}</h2>
      {children}
    </div>
  );
}
