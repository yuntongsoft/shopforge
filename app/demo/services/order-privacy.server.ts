import prisma from "~/db.server";
import { readSensitiveText } from "~/utils/encryption";
import { registerPrivacyProvider } from "~/services/privacy.server";

/** Demo order customer/notes may contain PII; cannot infer customer ownership from free text. */
registerPrivacyProvider({
  id: "demo-orders-v1",
  async inspect(domain, subject, redact) {
    const shop = await prisma.shop.findUnique({ where: { shopifyDomain: domain }, select: { id: true } });
    if (!shop) return { records: [], reviewRequired: false };
    const records: unknown[] = [];
    let reviewRequired = false;
    let cursor: string | undefined;
    for (;;) {
      const orders = await prisma.order.findMany({ where: { shopId: shop.id }, orderBy: { id: "asc" }, take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const order of orders) {
        const customer = readSensitiveText(order.customer);
        const note = readSensitiveText(order.note);
        const rawId = (id: string) => id.split("/").pop()!;
        const matched = !!(subject.customerId && order.customerId && rawId(order.customerId) === subject.customerId) ||
          subject.orderIds.includes(rawId(order.externalOrderId || order.id)) || !!(subject.email && customer === subject.email);
        if (matched) {
          if (redact) {
            await prisma.order.updateMany({ where: { id: order.id, shopId: shop.id }, data: { customer: "", note: "", customerId: null } });
          } else {
            if (records.length >= 10_000) throw new Error("Privacy export exceeds bounded export size; manual processing required");
            records.push({ id: order.id, orderNumber: order.orderNumber, customer, note, customerId: order.customerId,
              externalOrderId: order.externalOrderId, amount: order.amount, status: order.status, createdAt: order.createdAt });
          }
        } else if (!order.customerId && (customer || note)) reviewRequired = true;
      }
      if (orders.length < 500) break;
      cursor = orders[orders.length - 1].id;
    }
    return { records, reviewRequired };
  },
});
