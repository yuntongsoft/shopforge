/**
 * Tests for sanitize.ts — HTML sanitization and XSS prevention
 *
 * Coverage:
 *   - escapeHtml escapes all 5 special characters
 *   - sanitizeHtml strips script tags
 *   - sanitizeHtml removes event handler attributes
 *   - sanitizeHtml blocks javascript: URLs
 *   - sanitizeHtml preserves allowed tags
 *   - sanitizeText strips all HTML
 *   - Empty/null input handling
 */
import { describe, it, expect } from "vitest";
import { escapeHtml, sanitizeHtml, sanitizeText } from "~/utils/sanitize";

describe("escapeHtml", () => {
  it("should escape & < > \" '", () => {
    expect(escapeHtml(`<script>alert("xss")</script>`)).toBe(
      `&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;`
    );
  });

  it("should escape ampersands", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("should handle empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("should handle strings with no special chars", () => {
    expect(escapeHtml("hello world")).toBe("hello world");
  });
});

describe("sanitizeHtml", () => {
  it("should strip <script> tags and content", () => {
    const input = '<p>Hello</p><script>alert("xss")</script>';
    expect(sanitizeHtml(input)).toBe("<p>Hello</p>");
  });

  it("should remove event handler attributes", () => {
    const input = '<img src="x" onerror="alert(1)" />';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
  });

  it("should block javascript: URLs in href", () => {
    const input = '<a href="javascript:alert(1)">click</a>';
    const result = sanitizeHtml(input);
    expect(result).not.toContain("javascript:");
  });

  it("should preserve allowed tags", () => {
    const input = "<p><strong>Bold</strong> and <em>italic</em></p>";
    expect(sanitizeHtml(input)).toBe(input);
  });

  it("should strip disallowed tags but keep content", () => {
    const input = "<p>Hello <font>world</font></p>";
    const result = sanitizeHtml(input);
    expect(result).not.toContain("<font");
    expect(result).toContain("world");
  });

  it("should strip dangerous tags entirely including content", () => {
    expect(sanitizeHtml("<p>A</p><svg><script>alert(1)</script></svg>")).not.toContain("svg");
    expect(sanitizeHtml("<p>A</p><iframe src='x'>data</iframe>")).not.toContain("iframe");
    expect(sanitizeHtml("<p>A</p><iframe src='x'>data</iframe>")).not.toContain("data");
    expect(sanitizeHtml("<p>A</p><math><mi>x</mi></math>")).not.toContain("math");
  });

  it("should handle empty string", () => {
    expect(sanitizeHtml("")).toBe("");
  });
});

describe("sanitizeText", () => {
  it("should strip all HTML tags", () => {
    expect(sanitizeText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  it("should handle empty string", () => {
    expect(sanitizeText("")).toBe("");
  });

  it("should return plain text unchanged", () => {
    expect(sanitizeText("just text")).toBe("just text");
  });
});
