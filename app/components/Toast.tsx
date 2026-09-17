/**
 * File: components/Toast.tsx
 * Author: yuntongsoft
 * Date: 2026/08/25
 * Purpose: Toast notification component using Shopify App Bridge.
 *
 * Provides a `useToast()` hook for showing toast messages from any component.
 * The Toast component renders nothing itself — it delegates to App Bridge's
 * native toast system for consistent UX within the Shopify Admin.
 *
 * Usage:
 *   import { useToast } from "~/components/Toast";
 *   const { showToast } = useToast();
 *   showToast("Discount created!", "success");
 *
 * Dependencies: @shopify/app-bridge-react
 */
import { useAppBridge } from "@shopify/app-bridge-react";
import { useEffect, useState, createContext, useContext, useCallback } from "react";

interface ToastMessage {
  id: string;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastContextType {
  showToast: (message: string, type?: "success" | "error" | "info") => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {
    console.warn("Toast: showToast called outside of ToastProvider");
  },
});

/**
 * Hook to show toast notifications from any component within the app.
 */
export function useToast() {
  return useContext(ToastContext);
}

/**
 * Toast provider — wraps children with toast context and dispatches
 * messages to Shopify App Bridge's native toast system.
 *
 * Mount this once in app.tsx inside <AppProvider>. All descendant components
 * can then call `useToast()` to show native Shopify Admin toasts.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const shopify = useAppBridge();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: "success" | "error" | "info" = "success") => {
    // crypto.randomUUID() guarantees uniqueness across tabs and processes
    const id = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  useEffect(() => {
    if (toasts.length === 0) return;
    const current = toasts[0];
    shopify.toast.show(current.message, {
      isError: current.type === "error",
    });
    setToasts((prev) => prev.slice(1));
  }, [toasts, shopify]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
    </ToastContext.Provider>
  );
}

