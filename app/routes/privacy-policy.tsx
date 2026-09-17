/**
 * File: routes/privacy-policy.tsx
 * Author: yuntongsoft
 * Date: 2026/09/06
 * Purpose: Public privacy policy page — required for Shopify App Store listing
 *
 * This page is publicly accessible (no Shopify auth required).
 * Uses Remix links/headers system (no duplicate <html> tags).
 * Replace placeholder values with your actual app information.
 *
 * URL: https://shopforge.dev/privacy-policy
 */
import type { LinksFunction } from "@remix-run/node";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: "/styles/legal.css" },
];

export default function PublicPrivacyPolicy() {
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
        <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>Privacy Policy</h1>
        <p style={{ fontSize: 14, opacity: 0.85 }}>ShopForge for Shopify</p>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px 40px" }}>
        <p style={{ fontSize: 13, color: "#6d7175", marginBottom: 24 }}>Last updated: 2026-01-01</p>

        <LegalCard title="1. Information We Collect">
          <p>This app collects the following data to provide its core functionality:</p>
          <ul>
            <li><strong>Store information:</strong> Your Shopify store domain and authentication session data (access tokens are encrypted with AES-256-GCM).</li>
            <li><strong>App data:</strong> The data you create and manage within the app.</li>
            <li><strong>Usage logs:</strong> Records of app operations for analytics and debugging.</li>
          </ul>
          <p><strong>We do NOT collect:</strong> Customer names, email addresses, phone numbers, physical addresses, or any other personally identifiable information (PII) of your store&apos;s customers.</p>
        </LegalCard>

        <LegalCard title="2. How We Use Your Information">
          <ul>
            <li>To provide and maintain the app&apos;s core functionality.</li>
            <li>To securely authenticate with the Shopify API on your behalf.</li>
            <li>To generate analytics and usage statistics within the app.</li>
          </ul>
        </LegalCard>

        <LegalCard title="3. Data Storage & Security">
          <p>All data is stored securely on our servers. Access tokens are encrypted using AES-256-GCM encryption. We use industry-standard security practices to protect your data.</p>
        </LegalCard>

        <LegalCard title="4. Data Sharing">
          <p>We do not sell, trade, or share your data with third parties. Data is only shared with Shopify as required for the app to function.</p>
        </LegalCard>

        <LegalCard title="5. Data Deletion">
          <p>You can delete all your data at any time by uninstalling the app. Upon uninstallation, all stored data associated with your shop is permanently deleted within 30 days via the APP_UNINSTALLED webhook handler.</p>
        </LegalCard>

        <LegalCard title="6. Contact">
          <p>If you have questions about this Privacy Policy, please contact us through the Shopify App Store listing.</p>
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
