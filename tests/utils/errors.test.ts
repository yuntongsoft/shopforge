/**
 * Tests for errors.ts — error message extraction utility
 *
 * Coverage:
 *   - Error instances → .message
 *   - String throws → the string itself
 *   - Object throws → String(obj)
 *   - null/undefined → non-empty string
 */
import { describe, it, expect } from "vitest";
import { getErrorMessage } from "~/utils/errors";

describe("getErrorMessage", () => {
  it("should extract message from Error instance", () => {
    expect(getErrorMessage(new Error("something broke"))).toBe("something broke");
  });

  it("should extract message from TypeError", () => {
    expect(getErrorMessage(new TypeError("type mismatch"))).toBe("type mismatch");
  });

  it("should return string throws as-is", () => {
    expect(getErrorMessage("raw string error")).toBe("raw string error");
  });

  it("should convert object to string", () => {
    const result = getErrorMessage({ code: 500, detail: "internal" });
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("should handle null", () => {
    const result = getErrorMessage(null);
    expect(result).toBe("null");
  });

  it("should handle undefined", () => {
    const result = getErrorMessage(undefined);
    expect(result).toBe("undefined");
  });

  it("should handle number", () => {
    expect(getErrorMessage(42)).toBe("42");
  });

  it("always returns a string (including empty string input)", () => {
    const inputs = [new Error("x"), "y", {}, null, undefined, 0, false];
    for (const input of inputs) {
      const result = getErrorMessage(input);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    }
    // Empty string is a valid input — returns as-is (empty)
    expect(getErrorMessage("")).toBe("");
  });
});
