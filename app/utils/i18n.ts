/**
 * File: utils/i18n.ts
 * Author: yuntongsoft
 * Date: 2026/08/15
 * Purpose: Internationalization — useTranslation hook + locale management
 *
 * How to add a new language:
 *   1. Create app/locales/{locale}.json (copy en.json as template)
 *   2. Import it below and add to `translations` map
 *   3. Add ErrorBoundary translations in root.tsx
 *
 * Locale priority: URL param > localStorage > browser language > "en"
 *
 * Dependencies: react, @remix-run/react, locales/*.json
 * Used by: All pages that need translated text
 */
import { useState, useEffect, useCallback } from "react";
import en from "~/locales/en.json";
import zh from "~/locales/zh.json";
import ja from "~/locales/ja.json";
import es from "~/locales/es.json";

type TranslationKeys = typeof en;
type NestedKeyOf<T, K extends keyof T = keyof T> = K extends string
  ? T[K] extends Record<string, unknown>
    ? `${K}.${NestedKeyOf<T[K]>}`
    : K
  : never;

export type TranslationKey = NestedKeyOf<TranslationKeys>;

const translations: Record<string, typeof en> = { en, zh, ja, es };

const LOCALE_STORAGE_KEY = "shopforge_locale";
const LOCALE_COOKIE = "shopforge_locale";

/**
 * Same-tab event emitter for locale changes.
 * BroadcastChannel only notifies OTHER tabs/iframes, not the sender.
 * CustomEvent on window covers same-tab; BroadcastChannel covers cross-tab.
 */
const localeChangeEvt = "shopforge-locale-change";

/**
 * Get nested translation value by dot-separated path
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Replace {placeholder} tokens in translation string
 */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`
  );
}

/**
 * Translation hook — reads locale from server (DB) / URL / cookie / localStorage.
 *
 * Priority: URL param > serverLocale (DB) > cookie > localStorage > "en"
 *
 * Usage:
 *   const { t } = useTranslation(locale);  // pass loader's locale
 *   <Text>{t("pricing.title")}</Text>
 */
export function useTranslation(serverLocale?: string) {
  // Resolve locale: DB (server) > cookie > localStorage > "en"
  // NOTE: URL ?locale= param is Shopify admin's locale, NOT the user's app preference!
  const resolveLocale = useCallback((): string => {
    // 1. Server-side locale from DB (loader data — source of truth)
    if (serverLocale && translations[serverLocale]) return serverLocale;

    // 2. Cookie (set by client-side saveLocale for immediate cross-page effect)
    const cookieLocale = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${LOCALE_COOKIE}=`))
      ?.split("=")[1];
    if (cookieLocale && translations[cookieLocale]) return cookieLocale;

    // 3. localStorage fallback
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    return saved || "en";
  }, [serverLocale]);

  // Initialize synchronously — first render matches SSR (no hydration mismatch)
  const [locale, setLocale] = useState(() => resolveLocale());

  // Server locale changes (e.g., after navigation to a page with different DB value)
  useEffect(() => {
    setLocale(resolveLocale());
  }, [resolveLocale]);

  // Listen for locale changes (same-tab via CustomEvent + cross-tab via BroadcastChannel)
  useEffect(() => {
    const handler = (e: Event) => {
      const newLocale = (e as CustomEvent).detail?.locale;
      if (newLocale && translations[newLocale]) {
        setLocale(newLocale);
      }
    };
    window.addEventListener(localeChangeEvt, handler);

    let channel: BroadcastChannel | undefined;
    try {
      channel = new BroadcastChannel("shopforge_locale");
      channel.onmessage = (event) => {
        const newLocale = event.data?.locale;
        if (newLocale && translations[newLocale]) {
          setLocale(newLocale);
        }
      };
    } catch {
      // BroadcastChannel not supported
    }

    return () => {
      window.removeEventListener(localeChangeEvt, handler);
      channel?.close();
    };
  }, []);

  const t = translations[locale] || translations.en;

  const translate = (key: string, params?: Record<string, string | number>): string => {
    const value = getNestedValue(t as unknown as Record<string, unknown>, key);
    if (!value) {
      const fallback = getNestedValue(translations.en as unknown as Record<string, unknown>, key);
      return fallback || key;
    }
    return interpolate(value, params);
  };

  return { t: translate, locale };
}

/**
 * Save locale preference (call after language switch).
 * Notifies all useTranslation instances in same tab (CustomEvent)
 * and other tabs (BroadcastChannel).
 */
export function saveLocale(locale: string) {
  if (typeof window !== "undefined") {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; SameSite=None; Secure`;
    // Same-tab notification
    window.dispatchEvent(new CustomEvent(localeChangeEvt, { detail: { locale } }));
    // Cross-tab notification
    try {
      const channel = new BroadcastChannel("shopforge_locale");
      channel.postMessage({ locale });
      channel.close();
    } catch {
      // BroadcastChannel not supported
    }
  }
}

/**
 * Server-side translation (for loaders)
 */
export function getTranslation(locale: string = "en") {
  const resolvedLocale = translations[locale] ? locale : "en";
  const t = translations[resolvedLocale];
  const translate = (key: string, params?: Record<string, string | number>): string => {
    const value = getNestedValue(t as unknown as Record<string, unknown>, key);
    if (!value) {
      const fallback = getNestedValue(translations.en as unknown as Record<string, unknown>, key);
      return fallback || key;
    }
    return interpolate(value, params);
  };
  return { t: translate, locale: resolvedLocale };
}
