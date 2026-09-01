import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function makeBusiness(t: ReturnType<typeof convexTest>, slug: string) {
  return t.mutation(api.businesses.create, {
    name: `Business ${slug}`,
    slug,
    ownerUserId: `user_${slug}`,
  });
}

describe("agentSkills: upsert bumps version per (business, skillKey)", () => {
  it("replaces content and increments version on a second upsert", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "skill-a");

    const first = await t.mutation(api.agentSkills.upsert, {
      businessId,
      skillKey: "brandkit",
      content: "draft v1",
    });
    expect(first?.version).toBe(1);

    const second = await t.mutation(api.agentSkills.upsert, {
      businessId,
      skillKey: "brandkit",
      content: "draft v2",
    });
    expect(second?.version).toBe(2);
    expect(second?.content).toBe("draft v2");

    const skill = await t.query(api.agentSkills.get, { businessId, skillKey: "brandkit" });
    expect(skill?.content).toBe("draft v2");
    expect(skill?.version).toBe(2);

    const all = await t.query(api.agentSkills.listByBusiness, { businessId });
    expect(all.filter((s) => s.skillKey === "brandkit")).toHaveLength(1);
  });

  it("attaches new skills without any predefined key set", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "skill-b");

    await t.mutation(api.agentSkills.upsert, {
      businessId,
      skillKey: "outreach-email-designer",
      content: "draft v1",
    });

    const all = await t.query(api.agentSkills.listByBusiness, { businessId });
    expect(all.map((s) => s.skillKey)).toEqual(["outreach-email-designer"]);
  });
});

describe("agentSkills: tenancy", () => {
  it("never returns another business's skill for the same skillKey", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await makeBusiness(t, "skill-tenancy-a");
    const businessBId = await makeBusiness(t, "skill-tenancy-b");

    await t.mutation(api.agentSkills.upsert, {
      businessId: businessAId,
      skillKey: "brandkit",
      content: "A's brandkit",
    });

    const bSkill = await t.query(api.agentSkills.get, {
      businessId: businessBId,
      skillKey: "brandkit",
    });
    expect(bSkill).toBeNull();
  });
});
