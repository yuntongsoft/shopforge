/**
 * File: utils/sanitize.ts
 * Author: yuntongsoft
 * Date: 2026/08/06
 * Purpose: HTML sanitization utilities to prevent XSS attacks.
 *
 * Strips dangerous tags/attributes from user-generated HTML content
 * while preserving safe formatting tags.
 *
 * Dependencies: none (pure regex-based sanitizer, no external deps)
 * Used by: email service (sanitize shop/domain/user data in HTML templates)
 *
 * Usage:
 *   import { sanitizeHtml, sanitizeText } from "~/utils/sanitize";
 *   const safe = sanitizeHtml(userInput);
 *   const text = sanitizeText(userInput); // strips ALL HTML
 */

/**
 * Allowed HTML tags for email templates (whitelist approach).
 * Only these tags will be preserved after sanitization.
 *
 * NOTE: SVG, MATH, OBJECT, EMBED, IFRAME, SCRIPT, STYLE are intentionally
 * excluded — they can execute arbitrary scripts or load remote resources.
 */
const ALLOWED_TAGS = new Set([
  "p", "br", "b", "i", "u", "em", "strong", "a", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "div", "span", "table",
  "tr", "td", "th", "thead", "tbody", "blockquote", "pre", "code",
  "img",
]);

/**
 * Tags that must be stripped entirely (including content) because they can
 * execute scripts even when removed from the tag whitelist.
 * Example: <svg><script>alert(1)</script></svg>
 */
const DANGEROUS_TAGS_WITH_CONTENT = /<(script|style|svg|math|object|embed|iframe)\b[^<]*(?:(?!<\/\1>)<[^<]*)*<\/\1>/gi;

/**
 * Allowed HTML attributes (whitelist approach).
 * Only these attributes will be preserved on allowed tags.
 *
 * NOTE: "style" is excluded — CSS can contain expression() (IE) or
 * url() (data exfiltration). "formaction", "xlink:href", "data" are
 * also excluded as they can be abused in certain contexts.
 */
const ALLOWED_ATTRS = new Set([
  "href", "src", "alt", "title", "width", "height",
  "class", "id", "target", "rel", "colspan", "rowspan",
]);

/**
 * Dangerous URL schemes that should be blocked in href/src attributes.
 */
const DANGEROUS_SCHEMES = /^(javascript|data|vbscript):/i;

/**
 * Sanitize HTML content — strips dangerous tags and attributes.
 *
 * @param html - Raw HTML string
 * @returns Sanitized HTML with only safe tags/attributes preserved
 */
export function sanitizeHtml(html: string): string {
  if (!html) return "";

  // Remove dangerous tags and their content entirely (script, style, svg, math, object, embed, iframe)
  let result = html.replace(DANGEROUS_TAGS_WITH_CONTENT, "");

  // Remove event handler attributes (onclick, onerror, etc.)
  result = result.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Remove tags not in the whitelist
  result = result.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (match, tagName) => {
    const tag = tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";

    // For opening tags, filter attributes
    if (match.startsWith("</")) return match; // Closing tags are safe

    // Extract and filter attributes
    const attrs: string[] = [];
    const attrRegex = /\s+([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(match)) !== null) {
      const attrName = attrMatch[1].toLowerCase();
      const attrValue = attrMatch[2] || attrMatch[3] || attrMatch[4] || "";

      if (!ALLOWED_ATTRS.has(attrName)) continue;

      // Block dangerous URL schemes in href/src
      if ((attrName === "href" || attrName === "src") && DANGEROUS_SCHEMES.test(attrValue.trim())) {
        continue;
      }

      attrs.push(`${attrName}="${attrValue.replace(/"/g, "&quot;")}"`);
    }

    // Self-closing tags (br, img, hr)
    if (["br", "img", "hr"].includes(tag)) {
      return `<${tag}${attrs.length ? " " + attrs.join(" ") : ""} />`;
    }

    return `<${tag}${attrs.length ? " " + attrs.join(" ") : ""}>`;
  });

  return result;
}

/**
 * Strip ALL HTML tags from a string — returns plain text only.
 *
 * @param text - Raw string potentially containing HTML
 * @returns Plain text with all HTML tags removed
 */
export function sanitizeText(text: string): string {
  if (!text) return "";
  return text.replace(/<[^>]*>/g, "").trim();
}

/**
 * Escape HTML special characters to prevent XSS in text contexts.
 * Use this when inserting user data into HTML templates.
 *
 * @param text - Raw text to escape
 * @returns HTML-safe text (& < > " ' all escaped)
 */
export function escapeHtml(text: string): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
