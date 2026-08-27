import type { Doc } from "@/convex/_generated/dataModel";

export function serializeProduct(product: Doc<"products">) {
  return {
    id: product._id,
    title: product.title,
    description: product.description,
    priceAmountCents: product.priceAmountCents,
    currency: product.currency,
    status: product.status,
    stripeProductId: product.stripeProductId ?? null,
    stripePriceId: product.stripePriceId ?? null,
    deliverableFileUrl: product.deliverableFileUrl ?? null,
  };
}
