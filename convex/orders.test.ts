import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedBusinessWithActiveProduct(t: ReturnType<typeof convexTest>, slug: string) {
  const businessId = await t.mutation(internal.businesses.create, {
    name: `Business ${slug}`,
    slug,
    ownerUserId: `user_${slug}`,
  });
  const product = await t.mutation(internal.products.create, {
    businessId,
    title: "Handmade Mug",
    description: "A mug.",
    priceAmountCents: 1500,
    currency: "usd",
  });
  if (!product) throw new Error("unreachable");
  await t.mutation(internal.products.update, {
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

    const order = await t.mutation(internal.orders.createFromCheckoutSession, {
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

    const first = await t.mutation(internal.orders.createFromCheckoutSession, args);
    // Simulates Stripe redelivering the exact same checkout.session.completed
    // event (retry after a timeout, or a manual resend from the dashboard).
    const second = await t.mutation(internal.orders.createFromCheckoutSession, args);

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

    await t.mutation(internal.orders.createFromCheckoutSession, {
      businessId: a.businessId,
      productId: a.productId,
      customerEmail: "a@example.com",
      amountCents: 1500,
      currency: "usd",
      stripeCheckoutSessionId: "cs_test_a",
    });
    await t.mutation(internal.orders.createFromCheckoutSession, {
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

// THI-29 gate audit: products.test.ts and files.test.ts each have a direct
// real-Convex-layer (not route-mock) cross-tenant test against getScoped;
// this file didn't, even though getScopedById/markRefunded/markShipped all
// route through the same shared helper (convex/lib/tenancy.ts). Added to
// close that gap — mirrors convex/products.test.ts's
// "returns null (never another business's document) on cross-tenant update".
describe("orders: tenancy", () => {
  it("returns null (never the document) when a different business fetches the same order id", async () => {
    const t = convexTest(schema, modules);
    const a = await seedBusinessWithActiveProduct(t, "orders-tenancy-a");
    const b = await seedBusinessWithActiveProduct(t, "orders-tenancy-b");

    const order = await t.mutation(internal.orders.createFromCheckoutSession, {
      businessId: a.businessId,
      productId: a.productId,
      customerEmail: "buyer@example.com",
      amountCents: 1500,
      currency: "usd",
      stripeCheckoutSessionId: "cs_test_tenancy_get",
    });
    if (!order) throw new Error("unreachable");

    const crossTenantFetch = await t.query(internal.orders.getScopedById, {
      orderId: order._id,
      businessId: b.businessId,
    });
    expect(crossTenantFetch).toBeNull();
  });

  it("returns null (never refunds) when a different business calls markRefunded on the same order id", async () => {
    const t = convexTest(schema, modules);
    const a = await seedBusinessWithActiveProduct(t, "orders-tenancy-c");
    const b = await seedBusinessWithActiveProduct(t, "orders-tenancy-d");

    const order = await t.mutation(internal.orders.createFromCheckoutSession, {
      businessId: a.businessId,
      productId: a.productId,
      customerEmail: "buyer@example.com",
      amountCents: 1500,
      currency: "usd",
      stripeCheckoutSessionId: "cs_test_tenancy_refund",
    });
    if (!order) throw new Error("unreachable");

    const crossTenantRefund = await t.mutation(internal.orders.markRefunded, {
      businessId: b.businessId,
      orderId: order._id,
      refundedAt: Date.now(),
    });
    expect(crossTenantRefund).toBeNull();

    const stillA = await t.query(internal.orders.getScopedById, {
      orderId: order._id,
      businessId: a.businessId,
    });
    expect(stillA?.status).toBe("paid");
  });

  it("returns null (never ships) when a different business calls markShipped on the same order id", async () => {
    const t = convexTest(schema, modules);
    const a = await seedBusinessWithActiveProduct(t, "orders-tenancy-e");
    const b = await seedBusinessWithActiveProduct(t, "orders-tenancy-f");

    const order = await t.mutation(internal.orders.createFromCheckoutSession, {
      businessId: a.businessId,
      productId: a.productId,
      customerEmail: "buyer@example.com",
      amountCents: 1500,
      currency: "usd",
      stripeCheckoutSessionId: "cs_test_tenancy_ship",
    });
    if (!order) throw new Error("unreachable");

    const crossTenantShip = await t.mutation(internal.orders.markShipped, {
      businessId: b.businessId,
      orderId: order._id,
      shippedAt: Date.now(),
      trackingCode: "hijacked-tracking",
    });
    expect(crossTenantShip).toBeNull();

    const stillA = await t.query(internal.orders.getScopedById, {
      orderId: order._id,
      businessId: a.businessId,
    });
    expect(stillA?.shippedAt).toBeUndefined();
  });
});
