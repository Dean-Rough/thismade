import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function makeBusiness(t: ReturnType<typeof convexTest>, slug: string) {
  return t.mutation(internal.businesses.create, {
    name: `Business ${slug}`,
    slug,
    ownerUserId: `user_${slug}`,
  });
}

describe("agentContextFiles: upsert is a singleton per (business, fileKey)", () => {
  it("replaces content on a second upsert rather than accumulating rows", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "ctx-a");

    await t.mutation(internal.agentContextFiles.upsert, {
      businessId,
      fileKey: "SOUL",
      content: "draft v1",
    });
    await t.mutation(internal.agentContextFiles.upsert, {
      businessId,
      fileKey: "SOUL",
      content: "draft v2",
    });

    const file = await t.query(internal.agentContextFiles.get, { businessId, fileKey: "SOUL" });
    expect(file?.content).toBe("draft v2");

    const all = await t.query(internal.agentContextFiles.listByBusiness, { businessId });
    expect(all.filter((f) => f.fileKey === "SOUL")).toHaveLength(1);
  });
});

describe("agentContextFiles: tenancy", () => {
  it("never returns another business's file for the same fileKey", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await makeBusiness(t, "ctx-tenancy-a");
    const businessBId = await makeBusiness(t, "ctx-tenancy-b");

    await t.mutation(internal.agentContextFiles.upsert, {
      businessId: businessAId,
      fileKey: "OWNER",
      content: "A's owner profile",
    });

    const bFile = await t.query(internal.agentContextFiles.get, {
      businessId: businessBId,
      fileKey: "OWNER",
    });
    expect(bFile).toBeNull();
  });
});
