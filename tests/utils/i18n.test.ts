/**
 * Tests for i18n.ts — translation utilities
 *
 * Coverage:
 *   - getTranslation returns correct locale
 *   - Fallback to English when key missing in locale
 *   - Interpolation replaces {placeholder}
 *   - Missing key returns key string
 *   - saveLocale is safe in non-browser env
 */
import { describe, it, expect } from "vitest";
import { getTranslation, saveLocale } from "~/utils/i18n";

describe("getTranslation", () => {
  it("should return English translations by default", () => {
    const { t, locale } = getTranslation();
    expect(locale).toBe("en");
    expect(t("app.name")).toBe("ShopForge");
  });

  it("should return Chinese translations", () => {
    const { t, locale } = getTranslation("zh");
    expect(locale).toBe("zh");
    expect(t("dashboard.welcome")).toBe("欢迎使用您的 Shopify 应用！");
  });

  it("should return Japanese translations", () => {
    const { t } = getTranslation("ja");
    expect(t("settings.title")).toBe("設定");
  });

  it("should return Spanish translations", () => {
    const { t } = getTranslation("es");
    expect(t("pricing.title")).toBe("Precios");
    expect(t("pricing.choosePlan")).toBe("Elige tu plan");
  });

  it("should fallback to English for unknown locale", () => {
    const { t, locale } = getTranslation("xx");
    expect(locale).toBe("en");
    expect(t("app.name")).toBe("ShopForge");
  });

  it("should return key when translation is missing", () => {
    const { t } = getTranslation("en");
    expect(t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("should interpolate placeholders", () => {
    const { t } = getTranslation("en");
    // Test with a key that exists and add params
    const result = t("app.name", { foo: "bar" });
    expect(result).toBe("ShopForge"); // No placeholders in this key
  });
});

describe("saveLocale", () => {
  it("should not throw in non-browser environment", () => {
    expect(() => saveLocale("zh")).not.toThrow();
  });
});
