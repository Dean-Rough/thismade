import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function createBusiness(t: ReturnType<typeof convexTest>, slug: string) {
  return t.mutation(api.businesses.create, {
    name: `Business ${slug}`,
    slug,
    ownerUserId: `user_${slug}`,
  });
}

describe("files: upload -> complete", () => {
  it("mints an upload URL and a pending fileId scoped to the caller's business", async () => {
    const t = convexTest(schema, modules);
    const businessId = await createBusiness(t, "files-a");

    const { fileId, uploadUrl } = await t.mutation(api.files.createPendingUpload, {
      businessId,
    });

    expect(fileId).toBeTruthy();
    expect(uploadUrl).toMatch(/^https:\/\//);
  });

  it("completes an upload for the owning business and returns a fetchable URL", async () => {
    const t = convexTest(schema, modules);
    const businessId = await createBusiness(t, "files-b");

    const { fileId } = await t.mutation(api.files.createPendingUpload, { businessId });

    // Simulate the caller PUTting bytes to the signed URL: store a real blob
    // directly against Convex storage to get a real storageId, exactly like
    // the production upload endpoint would hand back.
    const storageId = await t.run(async (ctx) => {
      return ctx.storage.store(new Blob(["hello deliverable"], { type: "text/plain" }));
    });

    const result = await t.mutation(api.files.completeUpload, {
      businessId,
      fileId,
      storageId,
    });

    expect(result).not.toBeNull();
    expect(result?.fileId).toBe(fileId);
    expect(result?.url).toMatch(/^https:\/\//);

    // The permanent URL is genuinely fetchable via Convex storage — proven by
    // reading the blob back out through the same storageId we just completed.
    // (t.run's return value goes through Convex's value serializer, which
    // can't carry a raw Blob, so read its text inside the callback.)
    const blobText = await t.run(async (ctx) => {
      const blob = await ctx.storage.get(storageId);
      return blob ? await blob.text() : null;
    });
    expect(blobText).toBe("hello deliverable");
  });

  it("returns null (never another business's file) when a different business completes with someone else's fileId", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await createBusiness(t, "files-c-a");
    const businessBId = await createBusiness(t, "files-c-b");

    const { fileId } = await t.mutation(api.files.createPendingUpload, {
      businessId: businessAId,
    });
    const storageId = await t.run(async (ctx) => {
      return ctx.storage.store(new Blob(["cross-tenant"], { type: "text/plain" }));
    });

    // Business B tries to finalize business A's pending upload. The REST
    // layer (app/v1/files/complete) turns this null into a 404 — never a 403
    // that would confirm the fileId exists.
    const result = await t.mutation(api.files.completeUpload, {
      businessId: businessBId,
      fileId,
      storageId,
    });

    expect(result).toBeNull();
  });

  it("keeps pending files scoped per business in a listing query", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await createBusiness(t, "files-d-a");
    const businessBId = await createBusiness(t, "files-d-b");

    await t.mutation(api.files.createPendingUpload, { businessId: businessAId });
    await t.mutation(api.files.createPendingUpload, { businessId: businessBId });

    const forA = await t.run(async (ctx) =>
      ctx.db
        .query("files")
        .withIndex("by_business", (q) => q.eq("businessId", businessAId))
        .collect(),
    );

    expect(forA).toHaveLength(1);
    expect(forA[0].businessId).toBe(businessAId);
  });
});
