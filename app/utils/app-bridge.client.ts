/**
 * File: utils/app-bridge.client.ts
 * Author: yuntongsoft
 * Date: 2026/09/18
 * Purpose: SSR-safe access to Shopify App Bridge global object.
 *
 * WHY THIS EXISTS:
 * `window.shopify` (App Bridge) is only available in the browser after the
 * App Bridge CDN script loads. Accessing it during SSR or before script
 * injection causes "window is not defined" crashes. This utility provides
 * a single, safe access point used by all components.
 *
 * USAGE:
 *   import { getAppBridge } from "~/utils/app-bridge.client";
 *   const shopify = getAppBridge();
 *   shopify?.idToken?.()  // safe optional chaining
 *
 * IMPORTANT: Call this inside useEffect, event handlers, or after mount.
 * For components that render App Bridge React components (NavMenu), use
 * useState + useEffect to defer rendering until client-side mount.
 *
 * Dependencies: none
 * Used by: app.settings.tsx, pricing.tsx, Toast.tsx, and any component
 *          that needs to interact with App Bridge directly.
 */

/**
 * Shopify App Bridge global interface.
 * Minimal type — only the methods we use directly.
 */
interface ShopifyAppBridge {
  idToken: () => Promise<string>;
  toast: {
    show: (message: string, options?: { isError?: boolean }) => void;
  };
}

/**
 * SSR-safe access to the Shopify App Bridge global object.
 *
 * Returns null during server rendering or if App Bridge hasn't loaded yet.
 * Always use optional chaining (?.) on the result to handle null gracefully.
 */
export function getAppBridge(): ShopifyAppBridge | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).shopify ?? null;
}

/**
 * Authenticated fetch wrapper for Shopify embedded apps.
 *
 * Uses App Bridge's idToken() to obtain a session token and attaches it
 * as an Authorization header. This allows Remix loaders to verify the
 * request came from the embedded app iframe.
 *
 * @param url - The URL to fetch
 * @param init - Optional fetch options (method, body, headers, etc.)
 * @returns The fetch Response
 */
export async function authenticatedFetch(
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const shopify = getAppBridge();
  const headers = new Headers(init?.headers);
  if (shopify) {
    try {
      const token = await shopify.idToken();
      headers.set("Authorization", `Bearer ${token}`);
    } catch {
      // idToken may fail if App Bridge hasn't fully initialized; proceed without token
    }
  }
  return fetch(url, { ...init, headers });
}
