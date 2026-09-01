import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import { CONTEXT_FILE_KEYS } from "./lib/agentContextTemplates";

const modules = import.meta.glob("./**/*.ts");

async function makeBusiness(t: ReturnType<typeof convexTest>, slug: string) {
  return t.mutation(internal.businesses.create, {
    name: `Business ${slug}`,
    slug,
    ownerUserId: `user_${slug}`,
  });
}

describe("seedAgentContext.seedDefaults", () => {
  it("lands all 8 context files plus the brandkit skill via the existing upsert mutations", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "seed-a");

    const result = await t.action(internal.seedAgentContext.seedDefaults, {
      businessId,
      provisionedAtIso: "2026-09-01",
    });
    expect(result.fileKeys).toHaveLength(8);
    expect(result.skillKeys).toEqual(["brandkit"]);

    const files = await t.query(internal.agentContextFiles.listByBusiness, { businessId });
    expect(files).toHaveLength(8);
    for (const key of CONTEXT_FILE_KEYS) {
      const file = files.find((f) => f.fileKey === key);
      expect(file, `missing ${key}`).toBeDefined();
      expect(file!.content.length).toBeGreaterThan(200);
    }

    const skills = await t.query(internal.agentSkills.listByBusiness, { businessId });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.skillKey).toBe("brandkit");
    expect(skills[0]?.version).toBe(1);
    expect(skills[0]?.content.length).toBeGreaterThan(200);
  });

  it("substitutes the business's own name/slug into the rendered content", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "seed-b");

    await t.action(internal.seedAgentContext.seedDefaults, {
      businessId,
      provisionedAtIso: "2026-09-01",
    });

    const business = await t.query(internal.businesses.getSelf, { businessId });
    const soul = await t.query(internal.agentContextFiles.get, { businessId, fileKey: "SOUL" });
    const businessFile = await t.query(internal.agentContextFiles.get, {
      businessId,
      fileKey: "BUSINESS",
    });

    expect(soul?.content).toContain(business!.name);
    expect(businessFile?.content).toContain(business!.slug);
  });

  it("is safe to re-run: content stays a singleton row, skill version keeps incrementing", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "seed-c");

    await t.action(internal.seedAgentContext.seedDefaults, {
      businessId,
      provisionedAtIso: "2026-09-01",
    });
    await t.action(internal.seedAgentContext.seedDefaults, {
      businessId,
      provisionedAtIso: "2026-09-02",
    });

    const files = await t.query(internal.agentContextFiles.listByBusiness, { businessId });
    expect(files.filter((f) => f.fileKey === "MEMORY")).toHaveLength(1);
    const memory = files.find((f) => f.fileKey === "MEMORY");
    expect(memory?.content).toContain("2026-09-02");

    const skills = await t.query(internal.agentSkills.listByBusiness, { businessId });
    expect(skills).toHaveLength(1);
    expect(skills[0]?.version).toBe(2);
  });

  it("throws not_found for a nonexistent business rather than seeding orphaned rows", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "seed-d");
    // Use a real id shape but from a different, throwaway row so the id is
    // well-formed but resolves to nothing once deleted via a direct write.
    await t.run(async (ctx) => {
      await ctx.db.delete(businessId);
    });

    await expect(
      t.action(internal.seedAgentContext.seedDefaults, {
        businessId,
        provisionedAtIso: "2026-09-01",
      }),
    ).rejects.toThrow("not_found");
  });
});
