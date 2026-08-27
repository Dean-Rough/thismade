import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("tenancy: cross-business access", () => {
  it("returns null (never the document) when a business fetches another business's api key by id", async () => {
    const t = convexTest(schema, modules);

    const businessAId = await t.mutation(api.businesses.create, {
      name: "Business A",
      slug: "business-a",
      ownerUserId: "user_a",
    });
    const businessBId = await t.mutation(api.businesses.create, {
      name: "Business B",
      slug: "business-b",
      ownerUserId: "user_b",
    });

    const apiKeyAId = await t.mutation(api.apiKeys.create, {
      businessId: businessAId,
      name: "A's key",
      prefix: "tm_test_aaaa",
      hashedKey: "hash-of-a-key",
      scopes: ["read", "write"],
      createdByUserId: "user_a",
    });

    // The owning business can fetch its own key.
    const ownFetch = await t.query(api.apiKeys.getScopedById, {
      apiKeyId: apiKeyAId,
      businessId: businessAId,
    });
    expect(ownFetch).not.toBeNull();
    expect(ownFetch?._id).toBe(apiKeyAId);

    // A different business asking for the SAME id gets null — indistinguishable
    // from the id not existing at all. The REST layer turns this into a plain
    // 404 `not_found`, never a 403 that would confirm the row exists.
    const crossTenantFetch = await t.query(api.apiKeys.getScopedById, {
      apiKeyId: apiKeyAId,
      businessId: businessBId,
    });
    expect(crossTenantFetch).toBeNull();
  });

  it("never returns another business's row from a genuinely nonexistent id either, so the two cases are indistinguishable", async () => {
    const t = convexTest(schema, modules);

    const businessAId = await t.mutation(api.businesses.create, {
      name: "Business A",
      slug: "business-a-2",
      ownerUserId: "user_a",
    });
    const businessBId = await t.mutation(api.businesses.create, {
      name: "Business B",
      slug: "business-b-2",
      ownerUserId: "user_b",
    });

    const apiKeyBId = await t.mutation(api.apiKeys.create, {
      businessId: businessBId,
      name: "B's key",
      prefix: "tm_test_bbbb",
      hashedKey: "hash-of-b-key",
      scopes: ["read"],
      createdByUserId: "user_b",
    });

    const result = await t.query(api.apiKeys.getScopedById, {
      apiKeyId: apiKeyBId,
      businessId: businessAId,
    });
    expect(result).toBeNull();
  });

  it("businesses:getSelf only ever returns the business matching the given id — no cross-tenant leak path", async () => {
    const t = convexTest(schema, modules);

    const businessAId = await t.mutation(api.businesses.create, {
      name: "Business A",
      slug: "business-a-3",
      ownerUserId: "user_a",
    });
    const businessBId = await t.mutation(api.businesses.create, {
      name: "Business B",
      slug: "business-b-3",
      ownerUserId: "user_b",
    });

    const selfA = await t.query(api.businesses.getSelf, { businessId: businessAId });
    const selfB = await t.query(api.businesses.getSelf, { businessId: businessBId });

    expect(selfA?._id).toBe(businessAId);
    expect(selfB?._id).toBe(businessBId);
    expect(selfA?._id).not.toBe(selfB?._id);
    expect(selfA?.slug).toBe("business-a-3");
    expect(selfB?.slug).toBe("business-b-3");
  });
});
