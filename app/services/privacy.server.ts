import prisma from "~/db.server";
import { encrypt, decrypt } from "~/utils/encryption";
import { isValidShopDomain } from "~/utils/shopify-auth.server";

// TODO: integrate with scheduled maintenance runner for privacy-retention cleanup
// Expire sealed payloads and confirmations past their retention date
async function runRetentionCleanup() {
  await prisma.privacyRequest.updateMany({ where: {
    expiresAt: { lte: new Date() }, OR: [{ sealedPayload: { not: null } }, { confirmedBy: { not: null } }],
  }, data: { sealedPayload: null, confirmedBy: null } });
}

function assertShopDomain(shop: string): string {
  if (!isValidShopDomain(shop)) throw new Error(`Invalid shop domain: ${shop}`);
  return shop;
}

export interface PrivacySubject { customerId?: string; email?: string; orderIds: string[] }
export interface PrivacyProvider {
  id: string;
  inspect(shop: string, subject: PrivacySubject, redact: boolean): Promise<{ records: unknown[]; reviewRequired: boolean }>;
}
const providers = new Map<string, PrivacyProvider>();
export function registerPrivacyProvider(provider: PrivacyProvider) {
  if (providers.has(provider.id)) throw new Error("Duplicate privacy provider");
  providers.set(provider.id, provider);
}

export function parsePrivacySubject(payload: unknown): PrivacySubject {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid privacy payload");
  const data = payload as { customer?: { id?: unknown; email?: unknown }; orders_requested?: unknown; orders_to_redact?: unknown };
  const identifier = (value: unknown, resource: "Order" | "Customer"): string | undefined => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number" && !Number.isSafeInteger(value)) throw new Error("Unsafe Shopify identifier");
    if (typeof value !== "string" && typeof value !== "number") throw new Error("Invalid Shopify identifier");
    const id = String(value);
    const numeric = id.startsWith(`gid://shopify/${resource}/`) ? id.slice(`gid://shopify/${resource}/`.length) : id;
    if (numeric.length > 100 || !/^[1-9]\d*$/.test(numeric)) throw new Error("Invalid Shopify identifier");
    return numeric;
  };
  if (data.customer != null && (typeof data.customer !== "object" || Array.isArray(data.customer))) throw new Error("Invalid privacy customer");
  const ids = data.orders_to_redact ?? data.orders_requested ?? [];
  if (!Array.isArray(ids) || ids.length > 10_000 || ids.some((id) => id == null)) throw new Error("Invalid privacy order IDs");
  const email = data.customer?.email;
  if (email !== undefined && (typeof email !== "string" || email.length > 500)) throw new Error("Invalid customer email");
  return { customerId: identifier(data.customer?.id, "Customer"), email: email as string | undefined, orderIds: ids.map((id) => identifier(id, "Order")!) };
}

export async function expirePrivacyPayloads(shop: string) {
  await prisma.privacyRequest.updateMany({ where: { shop: assertShopDomain(shop), expiresAt: { lte: new Date() } }, data: { sealedPayload: null, confirmedBy: null } });
}

export async function receivePrivacyRequest(shop: string, webhookId: string, kind: "DATA_REQUEST" | "REDACT", payload: unknown): Promise<void> {
  assertShopDomain(shop);
  const subject = parsePrivacySubject(payload);
  await expirePrivacyPayloads(shop);
  const request = await prisma.privacyRequest.upsert({ where: { shop_webhookId: { shop, webhookId } }, update: {}, create: {
    shop, webhookId, kind, sealedPayload: encrypt(JSON.stringify(subject)), expiresAt: new Date(Date.now() + 30 * 86400000),
  } });
  if (request.kind !== kind) throw new Error("Privacy request identity conflict");
  if (request.completedAt || request.status === "READY" || request.status === "REVIEW_REQUIRED") return;
  const results = await Promise.all([...providers.values()].map((provider) => provider.inspect(shop, subject, kind === "REDACT")));
  const reviewRequired = results.some((result) => result.reviewRequired);
  // Auto-match does not equal merchant completed response; completion confirmation must be a separate authenticated action.
  await prisma.privacyRequest.updateMany({ where: { id: request.id, shop, confirmedAt: null }, data: {
    status: reviewRequired ? "REVIEW_REQUIRED" : "READY",
  } });
}

export async function exportPrivacyRequest(shop: string, id: string) {
  await expirePrivacyPayloads(shop);
  const request = await prisma.privacyRequest.findFirst({ where: { id, shop: assertShopDomain(shop) } });
  if (!request) throw new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!request.sealedPayload) throw new Response("Privacy request expired", { status: 410, headers: { "Cache-Control": "no-store" } });
  const stored: unknown = JSON.parse(decrypt(request.sealedPayload));
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) throw new Error("Invalid stored privacy subject");
  const data = stored as Record<string, unknown>;
  if (!Array.isArray(data.orderIds)) throw new Error("Invalid stored privacy order IDs");
  const subject = parsePrivacySubject({ customer: { id: data.customerId, email: data.email }, orders_requested: data.orderIds });
  const results = await Promise.all([...providers.values()].map(async (provider) => ({ provider: provider.id, ...await provider.inspect(shop, subject, false) })));
  return { requestId: id, kind: request.kind, subject, reviewRequired: request.status === "REVIEW_REQUIRED" || results.some((result) => result.reviewRequired), results };
}

export async function listPrivacyRequests(domain: string, cursor: string | null = null) {
  const shop = assertShopDomain(domain);
  await expirePrivacyPayloads(shop);
  if (cursor && (!/^[a-zA-Z0-9-]{1,100}$/.test(cursor) || !await prisma.privacyRequest.findFirst({ where: { id: cursor, shop }, select: { id: true } }))) {
    throw new Response(null, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  const rows = await prisma.privacyRequest.findMany({ where: { shop }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, kind: true, status: true, createdAt: true, expiresAt: true, confirmedAt: true },
  });
  const items = rows.slice(0, 50);
  return { items, nextCursor: rows.length > 50 ? items[items.length - 1].id : null };
}

export async function confirmPrivacyRequest(shop: string, id: string, actor: string): Promise<boolean> {
  const result = await prisma.privacyRequest.updateMany({ where: {
    id, shop: assertShopDomain(shop), confirmedAt: null, status: { in: ["READY", "REVIEW_REQUIRED"] },
  }, data: {
    status: "COMPLETED", completedAt: new Date(), confirmedAt: new Date(), confirmedBy: encrypt(actor),
  } });
  await expirePrivacyPayloads(shop);
  return result.count > 0;
}
