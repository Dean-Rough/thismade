import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedTwoBusinesses(t: ReturnType<typeof convexTest>) {
  const businessAId = await t.mutation(api.businesses.create, {
    name: "Business A",
    slug: `products-a-${Math.random().toString(36).slice(2)}`,
    ownerUserId: "user_a",
  });
  const businessBId = await t.mutation(api.businesses.create, {
    name: "Business B",
    slug: `products-b-${Math.random().toString(36).slice(2)}`,
    ownerUserId: "user_b",
  });
  return { businessAId, businessBId };
}

describe("products.create", () => {
  it("inserts a businessId-scoped row defaulting to status draft", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    const product = await t.mutation(api.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });

    expect(product?.businessId).toBe(businessAId);
    expect(product?.status).toBe("draft");
    expect(product?.stripeProductId).toBeUndefined();
    expect(product?.stripePriceId).toBeUndefined();
  });
});

describe("products.getScopedById: tenancy", () => {
  it("returns the product to its owning business", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    const product = await t.mutation(api.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const fetched = await t.query(api.products.getScopedById, {
      productId: product._id,
      businessId: businessAId,
    });
    expect(fetched?._id).toBe(product._id);
  });

  it("returns null (never the document) when a different business fetches the same id", async () => {
    const t = convexTest(schema, modules);
    const { businessAId, businessBId } = await seedTwoBusinesses(t);

    const product = await t.mutation(api.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const crossTenantFetch = await t.query(api.products.getScopedById, {
      productId: product._id,
      businessId: businessBId,
    });
    expect(crossTenantFetch).toBeNull();
  });
});

describe("products.update", () => {
  it("patches only the provided fields", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    const product = await t.mutation(api.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const updated = await t.mutation(api.products.update, {
      businessId: businessAId,
      productId: product._id,
      priceAmountCents: 2000,
    });

    expect(updated?.priceAmountCents).toBe(2000);
    expect(updated?.title).toBe("Handmade Mug");
    expect(updated?.status).toBe("draft");
  });

  it("archives a product via status: archived", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    const product = await t.mutation(api.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const updated = await t.mutation(api.products.update, {
      businessId: businessAId,
      productId: product._id,
      status: "archived",
    });

    expect(updated?.status).toBe("archived");
  });

  it("stores stripeProductId/stripePriceId when supplied", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    const product = await t.mutation(api.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const updated = await t.mutation(api.products.update, {
      businessId: businessAId,
      productId: product._id,
      status: "active",
      stripeProductId: "prod_test_123",
      stripePriceId: "price_test_123",
    });

    expect(updated?.status).toBe("active");
    expect(updated?.stripeProductId).toBe("prod_test_123");
    expect(updated?.stripePriceId).toBe("price_test_123");
  });

  it("returns null (never another business's document) on cross-tenant update", async () => {
    const t = convexTest(schema, modules);
    const { businessAId, businessBId } = await seedTwoBusinesses(t);

    const product = await t.mutation(api.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const crossTenantUpdate = await t.mutation(api.products.update, {
      businessId: businessBId,
      productId: product._id,
      title: "Hijacked",
    });
    expect(crossTenantUpdate).toBeNull();

    // The row itself must be untouched.
    const stillA = await t.query(api.products.getScopedById, {
      productId: product._id,
      businessId: businessAId,
    });
    expect(stillA?.title).toBe("Handmade Mug");
  });
});

describe("products.listByBusiness", () => {
  it("only returns the calling business's products", async () => {
    const t = convexTest(schema, modules);
    const { businessAId, businessBId } = await seedTwoBusinesses(t);

    await t.mutation(api.products.create, {
      businessId: businessAId,
      title: "A's Mug",
      description: "",
      priceAmountCents: 1000,
      currency: "usd",
    });
    await t.mutation(api.products.create, {
      businessId: businessBId,
      title: "B's Mug",
      description: "",
      priceAmountCents: 2000,
      currency: "usd",
    });

    const forA = await t.query(api.products.listByBusiness, { businessId: businessAId });
    expect(forA).toHaveLength(1);
    expect(forA[0]?.title).toBe("A's Mug");
  });
});
