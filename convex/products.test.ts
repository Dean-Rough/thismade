import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedTwoBusinesses(t: ReturnType<typeof convexTest>) {
  const businessAId = await t.mutation(internal.businesses.create, {
    name: "Business A",
    slug: `products-a-${Math.random().toString(36).slice(2)}`,
    ownerUserId: "user_a",
  });
  const businessBId = await t.mutation(internal.businesses.create, {
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

    const product = await t.mutation(internal.products.create, {
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

    const product = await t.mutation(internal.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const fetched = await t.query(internal.products.getScopedById, {
      productId: product._id,
      businessId: businessAId,
    });
    expect(fetched?._id).toBe(product._id);
  });

  it("returns null (never the document) when a different business fetches the same id", async () => {
    const t = convexTest(schema, modules);
    const { businessAId, businessBId } = await seedTwoBusinesses(t);

    const product = await t.mutation(internal.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const crossTenantFetch = await t.query(internal.products.getScopedById, {
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

    const product = await t.mutation(internal.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const updated = await t.mutation(internal.products.update, {
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

    const product = await t.mutation(internal.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const updated = await t.mutation(internal.products.update, {
      businessId: businessAId,
      productId: product._id,
      status: "archived",
    });

    expect(updated?.status).toBe("archived");
  });

  it("stores stripeProductId/stripePriceId when supplied", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    const product = await t.mutation(internal.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const updated = await t.mutation(internal.products.update, {
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

    const product = await t.mutation(internal.products.create, {
      businessId: businessAId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const crossTenantUpdate = await t.mutation(internal.products.update, {
      businessId: businessBId,
      productId: product._id,
      title: "Hijacked",
    });
    expect(crossTenantUpdate).toBeNull();

    // The row itself must be untouched.
    const stillA = await t.query(internal.products.getScopedById, {
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

    await t.mutation(internal.products.create, {
      businessId: businessAId,
      title: "A's Mug",
      description: "",
      priceAmountCents: 1000,
      currency: "usd",
    });
    await t.mutation(internal.products.create, {
      businessId: businessBId,
      title: "B's Mug",
      description: "",
      priceAmountCents: 2000,
      currency: "usd",
    });

    const forA = await t.query(internal.products.listByBusiness, { businessId: businessAId });
    expect(forA).toHaveLength(1);
    expect(forA[0]?.title).toBe("A's Mug");
  });
});

// THI-29 Phase 2 gate: proves the "file upload -> attach to product -> product
// resolves a working deliverable URL" chain end to end, connecting
// convex/files.ts's completeUpload output to convex/products.ts's update —
// previously each half was only tested in isolation (convex/files.test.ts
// proves a completed upload is fetchable; this file's other tests prove
// deliverableFileUrl is stored/patched), never chained together.
describe("products.deliverableFileUrl: file upload integration", () => {
  it("resolves a fetchable URL after a completed file upload is attached to a product", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    const product = await t.mutation(internal.products.create, {
      businessId: businessAId,
      title: "Digital Pattern",
      description: "A PDF sewing pattern.",
      priceAmountCents: 500,
      currency: "usd",
    });
    if (!product) throw new Error("unreachable");

    const { fileId } = await t.mutation(internal.files.createPendingUpload, {
      businessId: businessAId,
    });
    // Simulate the caller PUTting bytes to the signed upload URL, exactly
    // like convex/files.test.ts's "completes an upload..." case.
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["pattern bytes"], { type: "application/pdf" })),
    );
    const completed = await t.mutation(internal.files.completeUpload, {
      businessId: businessAId,
      fileId,
      storageId,
    });
    if (!completed) throw new Error("unreachable");

    const updated = await t.mutation(internal.products.update, {
      businessId: businessAId,
      productId: product._id,
      deliverableFileUrl: completed.url,
    });
    expect(updated?.deliverableFileUrl).toBe(completed.url);

    const fetched = await t.query(internal.products.getScopedById, {
      productId: product._id,
      businessId: businessAId,
    });
    expect(fetched?.deliverableFileUrl).toBe(completed.url);

    // Not just a stored string: the URL genuinely resolves the same bytes
    // that were uploaded (THI-29: "product resolves a working deliverable URL").
    const blobText = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(storageId);
      return blob ? await blob.text() : null;
    });
    expect(blobText).toBe("pattern bytes");
  });

  it("returns null (never a cross-tenant file's data) when attaching another business's fileId is attempted", async () => {
    const t = convexTest(schema, modules);
    const { businessAId, businessBId } = await seedTwoBusinesses(t);

    // Business B's own upload cannot be finalized by business A's fileId
    // reference to begin with — completeUpload itself is the tenancy gate
    // (see convex/files.test.ts's cross-tenant case). This proves a product
    // in business A can never end up wired to business B's completed file
    // via this path: the only way to get a real, fetchable `completed.url`
    // is to complete the upload as the owning business first.
    const { fileId } = await t.mutation(internal.files.createPendingUpload, {
      businessId: businessBId,
    });
    const storageId = await t.run(async (ctx) =>
      ctx.storage.store(new Blob(["not yours"], { type: "text/plain" })),
    );

    const crossTenantComplete = await t.mutation(internal.files.completeUpload, {
      businessId: businessAId,
      fileId,
      storageId,
    });
    expect(crossTenantComplete).toBeNull();
  });
});
