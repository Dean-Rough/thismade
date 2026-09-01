import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Storage layer only, same split as agentContextFiles: the actual skill
// prompt *content* (e.g. a "brandkit" image-gen skill) is a separate,
// Security & Compliance Reviewer-gated workstream — see THI-8's child
// issues. No skill prompt text lives in this repo file.
export const get = query({
  args: { businessId: v.id("businesses"), skillKey: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agentSkills")
      .withIndex("by_business_skill_key", (q) =>
        q.eq("businessId", args.businessId).eq("skillKey", args.skillKey),
      )
      .unique();
  },
});

export const listByBusiness = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agentSkills")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

// Upsert bumps `version` on every write instead of a plain replace —
// skills are "versioned prompt files" per docs/madethis-agent-architecture.md,
// unlike the singleton-replace agentContextFiles.upsert.
export const upsert = mutation({
  args: {
    businessId: v.id("businesses"),
    skillKey: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentSkills")
      .withIndex("by_business_skill_key", (q) =>
        q.eq("businessId", args.businessId).eq("skillKey", args.skillKey),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        version: existing.version + 1,
        updatedAt: now,
      });
      return ctx.db.get(existing._id);
    }
    const id = await ctx.db.insert("agentSkills", {
      businessId: args.businessId,
      skillKey: args.skillKey,
      content: args.content,
      version: 1,
      updatedAt: now,
    });
    return ctx.db.get(id);
  },
});
