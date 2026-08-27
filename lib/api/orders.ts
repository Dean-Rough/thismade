import type { Doc } from "@/convex/_generated/dataModel";

export function serializeOrder(order: Doc<"orders">) {
  return {
    id: order._id,
    productId: order.productId,
    customerEmail: order.customerEmail,
    amountCents: order.amountCents,
    currency: order.currency,
    status: order.status,
    shippedAt: order.shippedAt ?? null,
    shippingTrackingCode: order.shippingTrackingCode ?? null,
    refundedAt: order.refundedAt ?? null,
    createdAt: order.createdAt,
  };
}
