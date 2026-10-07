/**
 * File: services/webhook-outbound.ts
 * Author: yuntongsoft
 * Date: 2026/10/07
 * Purpose: Outbound webhook delivery service — sends event notifications to
 *          merchant-configured URLs with SSRF protection and HMAC-SHA256 signing.
 *
 * This enables merchants to receive real-time notifications when specific events
 * occur in the app (e.g. rule.created, rule.triggered, quota.warning). Each shop
 * can configure multiple webhook endpoints with per-endpoint secrets and event
 * subscriptions.
 *
 * Security features:
 *   - SSRF protection: validates target URL against private IPs, DNS rebinding, port whitelist
 *   - HMAC-SHA256 signing: recipients can verify payload authenticity
 *   - Exponential backoff retry: transient failures retried up to 2 times
 *   - 5s delivery timeout: prevents slow recipients from blocking the caller
 *
 * Dependencies: prisma (WebhookConfig table), crypto, dns, logger, retry
 * Used by: Any service that needs to notify merchants about app events
 *
 * Usage:
 *   import { emitWebhook, generateWebhookSecret } from "~/services/webhook-outbound";
 *   await emitWebhook(shopId, "rule.created", { ruleId: "123", name: "Buy 2 Get 1" });
 */
import crypto from "crypto";
import dns from "dns/promises";
import net from "net";
import { Agent } from "undici";
import { createLogger } from "~/utils/logger";
import prisma from "~/db.server";
import { withRetry } from "~/utils/retry";
import { getErrorMessage } from "~/utils/errors";

const logger = createLogger({ module: "webhook-outbound" });

// ─────────────────────────────────────────────────────────────────────────────
// SSRF Protection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if an IP address belongs to a private/reserved range.
 *
 * Covers: 10.0.0.0/8, 127.0.0.0/8, 0.0.0.0/8, 169.254.0.0/16 (link-local),
 * 172.16.0.0/12, 192.168.0.0/16, 100.64.0.0/10 (CGNAT),
 * and IPv6 loopback/ULA/link-local ranges.
 *
 * Security: This is a critical SSRF defense — never remove or weaken this check.
 */
function isPrivateIp(ip: string): boolean {
  if (net.isIP(ip) === 4) {
    const parts = ip.split(".").map(Number);
    if (parts[0] === 10) return true;                          // 10.0.0.0/8
    if (parts[0] === 127) return true;                         // 127.0.0.0/8 loopback
    if (parts[0] === 0) return true;                           // 0.0.0.0/8
    if (parts[0] === 169 && parts[1] === 254) return true;     // 169.254.0.0/16 link-local
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true; // 172.16.0.0/12
    if (parts[0] === 192 && parts[1] === 168) return true;     // 192.168.0.0/16
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT 100.64.0.0/10
    return false;
  }

  // IPv6 checks
  const lower = ip.toLowerCase();

  // IPv6-mapped IPv4 addresses (e.g., ::ffff:192.168.1.1)
  // Extract the IPv4 portion and validate it separately
  if (lower.startsWith("::ffff:")) {
    const ipv4Part = lower.slice(7); // Remove "::ffff:" prefix
    if (net.isIP(ipv4Part) === 4) {
      return isPrivateIp(ipv4Part); // Recursively check the IPv4 address
    }
  }

  if (
    lower === "::1" ||                                         // loopback
    lower === "::" ||                                          // unspecified
    lower.startsWith("fe80:") ||                               // link-local
    lower.startsWith("fc") || lower.startsWith("fd")           // ULA (unique local)
  ) {
    return true;
  }
  return false;
}

/**
 * Validate a webhook delivery URL against SSRF attacks.
 *
 * Checks performed:
 *   1. URL format (must be valid)
 *   2. Protocol (http/https only)
 *   3. Port whitelist (80, 443, 8080, 8443, 3000, 5000)
 *   4. Hostname (reject localhost, .local, .internal)
 *   5. DNS resolution → second pass of isPrivateIp on resolved addresses
 *
 * Returns the resolved IP on success so the caller can pin the connection
 * to this IP (preventing DNS rebinding — fetch() would otherwise re-resolve).
 */
async function validateWebhookUrl(
  rawUrl: string
): Promise<{ ok: true; pinnedIp: string; hostname: string } | { ok: false; reason: string }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Invalid URL format" };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Only http/https protocols supported" };
  }

  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (![80, 443, 8080, 8443, 3000, 5000].includes(port)) {
    return { ok: false, reason: `Port ${port} not in whitelist` };
  }

  const hostname = url.hostname.toLowerCase();

  // If hostname is a literal IP, check directly
  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      return { ok: false, reason: "Delivery to private/reserved IP addresses is blocked" };
    }
    return { ok: true, pinnedIp: hostname, hostname };
  }

  // Reject local/internal hostnames
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return { ok: false, reason: "Delivery to local/internal hostnames is blocked" };
  }

  // DNS resolution + second validation
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    for (const addr of addresses) {
      if (isPrivateIp(addr.address)) {
        return { ok: false, reason: `Domain resolves to private IP ${addr.address}` };
      }
    }
    // Pin the first resolved IP — the fetch will connect to this IP directly
    return { ok: true, pinnedIp: addresses[0].address, hostname };
  } catch (error) {
    return { ok: false, reason: `DNS resolution failed: ${(error as Error).message}` };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook event types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Outbound webhook event types.
 *
 * These are app-level events (not Shopify webhook topics) that merchants can
 * subscribe to via the WebhookConfig table. Add new event types as your app
 * grows — the events field in WebhookConfig stores a JSON array of these strings.
 */
export type WebhookEvent =
  | "rule.created"
  | "rule.updated"
  | "rule.deleted"
  | "rule.triggered"
  | "ab_test.complete"
  | "quota.warning"
  | (string & Record<string, never>);

// ─────────────────────────────────────────────────────────────────────────────
// Delivery
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a webhook event to all matching active configurations for a shop.
 *
 * For each matching WebhookConfig:
 *   1. Validate URL (SSRF protection)
 *   2. Sign payload with HMAC-SHA256 using the config's secret
 *   3. Deliver via POST with retry (exponential backoff, max 2 retries)
 *   4. Log success/failure with delivery ID for tracing
 *
 * Headers sent to recipient:
 *   - X-Webhook-Signature: sha256=<hex> — HMAC-SHA256 of the request body
 *   - X-Webhook-Event: event type string
 *   - X-Webhook-Delivery: unique delivery ID (UUID) for dedup/tracing
 *
 * PERFORMANCE: This function blocks until all deliveries complete (up to 5s per
 * delivery × 2 retries × N configs). If you don't want to block the caller, use
 * `setImmediate(() => emitWebhook(...))` or enqueue via a job queue.
 *
 * @param shopId - Shop ID to look up WebhookConfig records
 * @param event - Event type (must match config's subscribed events)
 * @param payload - Event data (will be JSON.stringify'd in the request body)
 */
export async function emitWebhook(
  shopId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const configs = await prisma.webhookConfig.findMany({
    where: { shopId, isActive: true },
  });

  // Filter configs that subscribe to this event
  // events field is stored as JSON string for cross-DB compatibility
  const matchingConfigs = configs.filter((c) => {
    try {
      const events: string[] = JSON.parse(c.events);
      return events.includes(event);
    } catch {
      return false;
    }
  });

  if (matchingConfigs.length === 0) return;

  const body = JSON.stringify({
    event,
    timestamp: new Date().toISOString(),
    data: payload,
  });

  for (const config of matchingConfigs) {
    const deliveryId = crypto.randomUUID();

    // SSRF protection: validate URL and pin resolved IP before every delivery
    const check = await validateWebhookUrl(config.url);
    if (!check.ok) {
      logger.warn(
        { shopId, webhookConfigId: config.id, url: config.url, reason: check.reason },
        "Webhook URL rejected (SSRF guard), skipping delivery"
      );
      continue;
    }

    // DNS pinning: connect to the validated IP directly, preventing rebinding.
    // The URL's hostname is replaced with the resolved IP; the original hostname
    // is sent via Host header and TLS servername (SNI) for correct cert verification.
    const pinnedUrl = new URL(config.url);
    const isHttps = pinnedUrl.protocol === "https:";
    const isIPv6 = net.isIP(check.pinnedIp) === 6;
    pinnedUrl.hostname = isIPv6 ? `[${check.pinnedIp}]` : check.pinnedIp;

    // For HTTPS, pin TLS servername so cert verification uses the original hostname
    const dispatcher = isHttps
      ? new Agent({ connect: { servername: check.hostname } })
      : undefined;

    // HMAC-SHA256 signature for payload verification (computed once, reused on retries)
    const signature = crypto
      .createHmac("sha256", config.secret)
      .update(body)
      .digest("hex");

    try {
      await withRetry(
        async () => {
          const response = await fetch(pinnedUrl.href, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Host": check.hostname,
              "X-Webhook-Signature": `sha256=${signature}`,
              "X-Webhook-Event": event,
              "X-Webhook-Delivery": deliveryId,
            },
            body,
            signal: AbortSignal.timeout(5000),
            // @ts-expect-error -- dispatcher is undici-specific (Node 18+ ships undici)
            dispatcher,
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response;
        },
        {
          maxRetries: 2,
          baseDelayMs: 1000,
          label: `webhook-delivery:${event}:${config.id}`,
        }
      );

      logger.info(
        { shopId, webhookConfigId: config.id, event, deliveryId },
        "Webhook delivered successfully"
      );
    } catch (error) {
      logger.error(
        {
          shopId,
          webhookConfigId: config.id,
          event,
          deliveryId,
          error: getErrorMessage(error),
        },
        "Webhook delivery failed after retries"
      );
    } finally {
      // Close the pinned-connection agent to prevent socket leaks
      if (dispatcher) {
        await dispatcher.close();
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Secret generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure webhook signing secret.
 * Returns a 64-character hex string (32 random bytes).
 *
 * Use this when creating new WebhookConfig records:
 *   const secret = generateWebhookSecret();
 *   await prisma.webhookConfig.create({ data: { ..., secret } });
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}
