import { beforeEach, describe, expect, it, vi } from "vitest";
const { db } = vi.hoisted(() => ({ db: {
  shop: { findUnique: vi.fn() }, order: { findMany: vi.fn(), updateMany: vi.fn() },
  privacyRequest: { upsert: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
} }));
vi.mock("~/db.server", () => ({ default: db }));
import { parsePrivacySubject, receivePrivacyRequest, exportPrivacyRequest, confirmPrivacyRequest } from "~/services/privacy.server";
import "~/demo/services/order-privacy.server";
import { decrypt, encrypt, readSensitiveText } from "~/utils/encryption";
const shop = "test.myshopify.com";
const payload = { customer: { id: 123, email: "customer@example.test" }, orders_to_redact: [789] };
const order = (overrides = {}) => ({ id: "order", shopId: "s", orderNumber: "#1", customer: "customer@example.test", note: "Delivery: evening", customerId: null, externalOrderId: null, amount: 19, status: "paid", createdAt: new Date(), ...overrides });
beforeEach(() => {
  vi.resetAllMocks(); db.shop.findUnique.mockResolvedValue({ id: "s" }); db.order.findMany.mockResolvedValue([]);
  db.privacyRequest.upsert.mockImplementation(async ({ create }) => ({ id: "privacy-1", status: "PENDING", ...create }));
  db.privacyRequest.updateMany.mockResolvedValue({ count: 1 });
});
describe("Privacy request and order isolation", () => {
  it("Accurately parses Shopify numbers and GID", () => expect(parsePrivacySubject({ customer: { id: "gid://shopify/Customer/123" }, orders_requested: [789] })).toEqual({ customerId: "123", email: undefined, orderIds: ["789"] }));
  it.each([[], { customer: "invalid" }, { customer: { id: Number.MAX_SAFE_INTEGER + 1 } }, { orders_to_redact: [null] }, { orders_requested: "123" }])("Rejects invalid payload %j", (value) => expect(() => parsePrivacySubject(value)).toThrow());
  it.each([
    { customer: { id: "gid://shopify/Order/123" } },
    { orders_requested: ["gid://shopify/Customer/789"] },
    { customer: { id: 0 } }, { customer: { id: -1 } },
    { orders_to_redact: ["1".repeat(101)] },
  ])("Rejects wrong resource type or invalid numeric ID %j", (value) => expect(() => parsePrivacySubject(value)).toThrow());
  it("Historical free text colon not treated as Token ciphertext", () => expect(readSensitiveText("Delivery: evening")).toBe("Delivery: evening"));
  it("Corrupted version ciphertext must not degrade to plaintext", () => expect(() => readSensitiveText("enc:v1:bad")).toThrow());
  it("Request encrypts sensitive fields and sets retention period", async () => {
    await receivePrivacyRequest(shop, "event", "DATA_REQUEST", payload);
    const create = db.privacyRequest.upsert.mock.calls[0][0].create;
    expect(create.sealedPayload).not.toContain("customer@example.test"); expect(JSON.parse(decrypt(create.sealedPayload)).customerId).toBe("123");
    expect(create.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86400000);
  });
  it("Email exact match only anonymizes PII of current tenant's financial orders", async () => {
    db.order.findMany.mockResolvedValue([order()]); await receivePrivacyRequest(shop, "e", "REDACT", payload);
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { shopId: "s" } }));
    expect(db.order.updateMany).toHaveBeenCalledWith({ where: { id: "order", shopId: "s" }, data: { customer: "", note: "", customerId: null } });
    const last = db.privacyRequest.updateMany.mock.calls.at(-1)![0]; expect(last.data).toEqual({ status: "READY" }); expect(last.data).not.toHaveProperty("completedAt");
  });
  it.each([{ customerId: "gid://shopify/Customer/123" }, { externalOrderId: "gid://shopify/Order/789" }, { id: "gid://shopify/Order/789" }])("Associated ID match %j", async (value) => {
    db.order.findMany.mockResolvedValue([order({ customer: "other", ...value })]); await receivePrivacyRequest(shop, "e", "REDACT", payload); expect(db.order.updateMany).toHaveBeenCalledTimes(1);
  });
  it("Fuzzy email and free text pending manual review rather than false positive completion", async () => {
    db.order.findMany.mockResolvedValue([order({ customer: "Contact: customer@example.test" })]); await receivePrivacyRequest(shop, "e", "REDACT", payload);
    expect(db.order.updateMany).not.toHaveBeenCalled(); expect(db.privacyRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: "REVIEW_REQUIRED" } }));
  });
  it("Repeated anonymization does not override already recorded manual review status", async () => {
    db.privacyRequest.upsert.mockResolvedValue({ id: "p", kind: "REDACT", status: "REVIEW_REQUIRED" });
    await receivePrivacyRequest(shop, "e", "REDACT", payload); expect(db.order.findMany).not.toHaveBeenCalled();
  });
  it("Export only queries current tenant, other tenant ID returns 404", async () => {
    db.privacyRequest.findFirst.mockResolvedValue(null); await expect(exportPrivacyRequest(shop, "other-id")).rejects.toMatchObject({ status: 404 });
    expect(db.privacyRequest.findFirst).toHaveBeenCalledWith({ where: { id: "other-id", shop } }); expect(db.order.findMany).not.toHaveBeenCalled();
  });
  it("Export expired details returns 410", async () => {
    db.privacyRequest.findFirst.mockResolvedValue({ sealedPayload: null }); await expect(exportPrivacyRequest(shop, "id")).rejects.toMatchObject({ status: 410 });
  });
  it("Export decrypts data but does not return non-matching customer records", async () => {
    db.privacyRequest.findFirst.mockResolvedValue({ sealedPayload: encrypt(JSON.stringify(parsePrivacySubject(payload))), kind: "DATA_REQUEST", status: "READY" });
    db.order.findMany.mockResolvedValue([order({ customer: encrypt("customer@example.test"), note: encrypt("Delivery: evening") }), order({ id: "unrelated", customer: "other@example.test", customerId: "999" })]);
    const result = await exportPrivacyRequest(shop, "id"); expect(result.results[0].records).toHaveLength(1); expect(result.results[0].records[0]).toMatchObject({ customer: "customer@example.test", note: "Delivery: evening" });
  });
  it.each([null, [], {}, { orderIds: "789" }, { orderIds: [null] },
    { orderIds: [], customerId: "gid://shopify/Order/123" }, { orderIds: [], email: 123 },
  ])("Export rejects corrupted storage structure and does not query orders %j", async (stored) => {
    db.privacyRequest.findFirst.mockResolvedValue({ sealedPayload: encrypt(JSON.stringify(stored)) });
    await expect(exportPrivacyRequest(shop, "id")).rejects.toThrow();
    expect(db.order.findMany).not.toHaveBeenCalled();
  });
  it("Manual confirmation records executor separately with tenant condition", async () => {
    await confirmPrivacyRequest(shop, "id", "staff-123"); const first = db.privacyRequest.updateMany.mock.calls[0][0];
    expect(first.where).toMatchObject({ id: "id", shop, confirmedAt: null, status: { in: ["READY", "REVIEW_REQUIRED"] } });
    expect(decrypt(first.data.confirmedBy)).toBe("staff-123"); expect(first.data.confirmedAt).toBeInstanceOf(Date);
  });
});
