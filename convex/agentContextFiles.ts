import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Storage layer only. The generated *content* for these files (SOUL/OWNER/
// BUSINESS/PLATFORM/PLAYBOOK/RUNBOOK/MEMORY/CODE_MAP) is a separate,
// Security & Compliance Reviewer-gated workstream — see THI-8's child
// issues. No template text lives in this repo file.
//
// Internal-only (THI-56): every function here is fronted by the matching
// action in agentContextFilesActions.ts, same pattern as THI-42.
const FILE_KEY = v.union(
  v.literal("SOUL"),
  v.literal("OWNER"),
  v.literal("BUSINESS"),
  v.literal("PLATFORM"),
  v.literal("PLAYBOOK"),
  v.literal("RUNBOOK"),
  v.literal("MEMORY"),
  v.literal("CODE_MAP"),
);

export const get = internalQuery({
  args: { businessId: v.id("businesses"), fileKey: FILE_KEY },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agentContextFiles")
      .withIndex("by_business_file_key", (q) =>
        q.eq("businessId", args.businessId).eq("fileKey", args.fileKey),
      )
      .unique();
  },
});

export const listByBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agentContextFiles")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

// Upsert: context files are singleton-per-(business, fileKey) — writing
// again replaces the row rather than accumulating history. Revisit if a
// later phase needs revision history on these files.
export const upsert = internalMutation({
  args: {
    businessId: v.id("businesses"),
    fileKey: FILE_KEY,
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("agentContextFiles")
      .withIndex("by_business_file_key", (q) =>
        q.eq("businessId", args.businessId).eq("fileKey", args.fileKey),
      )
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { content: args.content, updatedAt: now });
      return ctx.db.get(existing._id);
    }
    const id = await ctx.db.insert("agentContextFiles", {
      businessId: args.businessId,
      fileKey: args.fileKey,
      content: args.content,
      updatedAt: now,
    });
    return ctx.db.get(id);
  },
});
