import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedBusinessWithActiveProduct(t: ReturnType<typeof convexTest>, slug: string) {
  const businessId = await t.mutation(api.businesses.create, {
    name: `Business ${slug}`,
    slug,
    ownerUserId: `user_${slug}`,
  });
  const product = await t.mutation(api.products.create, {
    businessId,
    title: "Handmade Mug",
    description: "A mug.",
    priceAmountCents: 1500,
    currency: "usd",
  });
  if (!product) throw new Error("unreachable");
  await t.mutation(api.products.update, {
    businessId,
    productId: product._id,
    status: "active",
    stripeProductId: "prod_test_123",
    stripePriceId: "price_test_123",
  });
  return { businessId, productId: product._id };
}

describe("orders.createFromCheckoutSession", () => {
  it("inserts a paid order scoped to the business, keyed on the Stripe session id", async () => {
    const t = convexTest(schema, modules);
    const { businessId, productId } = await seedBusinessWithActiveProduct(t, "orders-a");

    const order = await t.mutation(api.orders.createFromCheckoutSession, {
      businessId,
      productId,
      customerEmail: "buyer@example.com",
      amountCents: 1500,
      currency: "usd",
      stripeCheckoutSessionId: "cs_test_abc",
    });

    expect(order?.businessId).toBe(businessId);
    expect(order?.productId).toBe(productId);
    expect(order?.status).toBe("paid");
    expect(order?.customerEmail).toBe("buyer@example.com");
    expect(order?.stripeCheckoutSessionId).toBe("cs_test_abc");
    expect(order?.shippedAt).toBeUndefined();
    expect(order?.refundedAt).toBeUndefined();
  });

  it("returns the existing order instead of inserting a duplicate on a redelivered webhook", async () => {
    const t = convexTest(schema, modules);
    const { businessId, productId } = await seedBusinessWithActiveProduct(t, "orders-b");

    const args = {
      businessId,
      productId,
      customerEmail: "buyer@example.com",
      amountCents: 1500,
      currency: "usd",
      stripeCheckoutSessionId: "cs_test_redelivered",
    };

    const first = await t.mutation(api.orders.createFromCheckoutSession, args);
    // Simulates Stripe redelivering the exact same checkout.session.completed
    // event (retry after a timeout, or a manual resend from the dashboard).
    const second = await t.mutation(api.orders.createFromCheckoutSession, args);

    expect(second?._id).toBe(first?._id);

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("orders")
        .withIndex("by_stripe_session", (q) => q.eq("stripeCheckoutSessionId", "cs_test_redelivered"))
        .collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it("scopes orders per business in a direct listing", async () => {
    const t = convexTest(schema, modules);
    const a = await seedBusinessWithActiveProduct(t, "orders-c-a");
    const b = await seedBusinessWithActiveProduct(t, "orders-c-b");

    await t.mutation(api.orders.createFromCheckoutSession, {
      businessId: a.businessId,
      productId: a.productId,
      customerEmail: "a@example.com",
      amountCents: 1500,
      currency: "usd",
      stripeCheckoutSessionId: "cs_test_a",
    });
    await t.mutation(api.orders.createFromCheckoutSession, {
      businessId: b.businessId,
      productId: b.productId,
      customerEmail: "b@example.com",
      amountCents: 2000,
      currency: "usd",
      stripeCheckoutSessionId: "cs_test_b",
    });

    const forA = await t.run(async (ctx) =>
      ctx.db
        .query("orders")
        .withIndex("by_business", (q) => q.eq("businessId", a.businessId))
        .collect(),
    );
    expect(forA).toHaveLength(1);
    expect(forA[0]?.customerEmail).toBe("a@example.com");
  });
});
