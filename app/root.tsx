/**
 * File: root.tsx
 * Author: yuntongsoft
 * Date: 2026/08/24
 * Purpose: Remix root — HTML shell, loading indicator, global error boundary
 *
 * Loading overlay lifecycle:
 *   1. HTML renders with #app-loading spinner (instant visual feedback)
 *   2. React mounts → useEffect sets __REACT_MOUNTED__ and fades out overlay
 *   3. If React fails → 15s timeout shows error message + refresh button
 *   4. If error thrown → ErrorBoundary removes overlay immediately
 *
 * Dependencies: @remix-run/react
 * Used by: Remix framework entry
 */
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "@remix-run/react";
import { useEffect, Suspense } from "react";
import type { LinksFunction } from "@remix-run/node";

// Extend Window type for loading overlay coordination
declare global {
  interface Window {
    __REACT_MOUNTED__?: boolean;
    __loadingText?: string;
  }
}

/**
 * ErrorBoundary i18n — cannot use useTranslation (outside AppProvider)
 * Detects locale from URL param → localStorage → browser language
 */
const ERROR_I18N: Record<string, Record<string, string>> = {
  en: {
    notFound: "Page not found",
    error: "Something went wrong",
    notFoundDesc: "The page you're looking for doesn't exist.",
    errorDesc: "An unexpected error occurred. Please try again or contact support.",
    expired: "Session Expired",
    recovering: "Auto-recovering, please wait...",
    back: "Back to Dashboard",
  },
  zh: {
    notFound: "页面未找到",
    error: "出错了",
    notFoundDesc: "您访问的页面不存在。",
    errorDesc: "发生意外错误，请重试或联系技术支持。",
    expired: "会话已过期",
    recovering: "正在自动恢复，请稍候...",
    back: "返回主页",
  },
  ja: {
    notFound: "ページが見つかりません",
    error: "エラーが発生しました",
    notFoundDesc: "お探しのページは存在しません。",
    errorDesc: "予期しないエラーが発生しました。もう一度お試しいただくか、サポートにお問い合わせください。",
    expired: "セッションが期限切れです",
    recovering: "自動回復中、お待ちください...",
    back: "ダッシュボードに戻る",
  },
  es: {
    notFound: "Página no encontrada",
    error: "Algo salió mal",
    notFoundDesc: "La página que buscas no existe.",
    errorDesc: "Ocurrió un error inesperado. Inténtalo de nuevo o contacta con soporte.",
    expired: "Sesión expirada",
    recovering: "Recuperando automáticamente, por favor espera...",
    back: "Volver al panel",
  },
};

function detectLocale(): string {
  if (typeof window === "undefined") return "en";
  const params = new URLSearchParams(window.location.search);
  const urlLocale = params.get("locale");
  if (urlLocale && ERROR_I18N[urlLocale]) return urlLocale;
  try {
    const stored = localStorage.getItem("shopforge_locale");
    if (stored && ERROR_I18N[stored]) return stored;
  } catch { /* localStorage unavailable */ }
  const browserLang = navigator.language?.slice(0, 2);
  if (browserLang && ERROR_I18N[browserLang]) return browserLang;
  return "en";
}

export const links: LinksFunction = () => [
  { rel: "theme-color", href: "#008060" },
];

export default function App() {
  // Remove loading overlay only after React successfully mounts
  useEffect(() => {
    window.__REACT_MOUNTED__ = true;
    const loader = document.getElementById("app-loading");
    if (loader) {
      loader.classList.add("fade-out");
      setTimeout(() => loader.remove(), 300);
    }
  }, []);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              #app-loading {
                position: fixed; inset: 0;
                display: flex; flex-direction: column;
                align-items: center; justify-content: center;
                background: #f6f6f7; z-index: 9999;
                transition: opacity 0.3s ease-out;
              }
              #app-loading.fade-out { opacity: 0; pointer-events: none; }
              #app-loading .spinner {
                width: 40px; height: 40px;
                border: 3px solid #e1e3e5; border-top-color: #008060;
                border-radius: 50%; animation: spin 0.8s linear infinite;
              }
              #app-loading .loading-text {
                margin-top: 16px;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px; color: #6d7175;
              }
              #app-loading .error-hint {
                display: none; margin-top: 24px;
                padding: 16px 24px; max-width: 400px; text-align: center;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 14px; color: #d72c0d;
                background: #fff4f4; border-radius: 8px; border: 1px solid #ffb8b8;
              }
              #app-loading .error-hint a { color: #008060; text-decoration: underline; }
              @keyframes spin { to { transform: rotate(360deg); } }
              @media (prefers-color-scheme: dark) {
                #app-loading { background: #1a1a1a; }
                #app-loading .spinner { border-color: #3d3d3d; border-top-color: #008060; }
                #app-loading .loading-text { color: #a0a0a0; }
              }
            `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var texts = { en:'Loading...', zh:'加载中...' };
                var locale = 'en';
                var p = new URLSearchParams(window.location.search);
                var u = p.get('locale');
                if (u && texts[u]) locale = u;
                else { var b = navigator.language?.slice(0,2); if (b && texts[b]) locale = b; }
                var el = document.getElementById('loading-text');
                if (el) el.textContent = texts[locale] || texts.en;
              })();
            `,
          }}
        />
      </head>
      <body>
        <div id="app-loading">
          <div className="spinner" />
          <div className="loading-text" id="loading-text">Loading...</div>
          <div className="error-hint" id="loading-error">
            The app is taking too long to load. Please try refreshing.
            <br />
            <a href="#" onClick={(e) => { e.preventDefault(); window.location.reload(); }}>Refresh page</a>
          </div>
        </div>
        <Suspense fallback={<div style={{ padding: 40, textAlign: "center", color: "#6d7175" }}>Loading…</div>}>
          <Outlet />
        </Suspense>
        <ScrollRestoration />
        <Scripts />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              setTimeout(function() {
                if (!window.__REACT_MOUNTED__) {
                  var s = document.querySelector('#app-loading .spinner');
                  var t = document.getElementById('loading-text');
                  var e = document.getElementById('loading-error');
                  if (s) s.style.display = 'none';
                  if (t) t.style.display = 'none';
                  if (e) e.style.display = 'block';
                }
              }, 15000);
            `,
          }}
        />
      </body>
    </html>
  );
}

/**
 * Global error boundary — catches render errors, shows user-friendly page
 * Cannot use Polaris components here (outside AppProvider)
 *
 * 401 auto-recovery: refreshes page to let App Bridge re-inject Session Token
 * Rate-limited to 1 refresh per 30s to prevent infinite loops
 */
export function ErrorBoundary() {
  const error = useRouteError();
  const isNotFound = !!(error && typeof error === "object" && "status" in error && (error as any).status === 404);
  const isUnauthorized = !!(error && typeof error === "object" && "status" in error && (error as any).status === 401);
  const locale = detectLocale();
  const t = ERROR_I18N[locale] || ERROR_I18N.en;

  // Remove loading overlay immediately on error
  if (typeof window !== "undefined") {
    window.__REACT_MOUNTED__ = true;
    const loader = document.getElementById("app-loading");
    if (loader) loader.remove();
  }

  // 401 auto-recovery: refresh to re-inject Session Token (max 1 per 30s)
  if (isUnauthorized && typeof window !== "undefined") {
    const lastRefresh = sessionStorage.getItem("_401_refresh_time");
    const now = Date.now();
    if (!lastRefresh || now - parseInt(lastRefresh) > 30000) {
      sessionStorage.setItem("_401_refresh_time", String(now));
      setTimeout(() => window.location.reload(), 1000);
    }
  }

  return (
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 40px; background: #f6f6f7; }
              .error-card { max-width: 480px; margin: 80px auto; background: #fff; border-radius: 12px; padding: 40px; box-shadow: 0 1px 3px rgba(0,0,0,.08); text-align: center; }
              .error-card h2 { margin: 0 0 8px; font-size: 20px; color: #202223; }
              .error-card p { margin: 0 0 24px; font-size: 14px; color: #6d7175; }
              .error-card a { display: inline-block; padding: 10px 20px; background: #008060; color: #fff; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 500; }
              .error-card a:hover { background: #006e52; }
              .refreshing { margin-top: 16px; font-size: 13px; color: #008060; }
            `,
          }}
        />
        {isUnauthorized && <meta httpEquiv="refresh" content="3" />}
      </head>
      <body>
        <div className="error-card">
          <h2>
            {isNotFound
              ? t.notFound
              : isUnauthorized
                ? t.expired
                : t.error}
          </h2>
          <p>
            {isUnauthorized
              ? t.recovering
              : isNotFound
                ? t.notFoundDesc
                : t.errorDesc}
          </p>
          <a href="/app">{t.back}</a>
          {isUnauthorized && <div className="refreshing">{t.recovering}</div>}
        </div>
        <Scripts />
      </body>
    </html>
  );
}
