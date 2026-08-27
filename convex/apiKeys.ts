import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getScoped } from "./lib/tenancy";
import type { Doc, Id } from "./_generated/dataModel";

const SCOPE = v.union(
  v.literal("read"),
  v.literal("write"),
  v.literal("money"),
  v.literal("ads"),
);

export const create = mutation({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    prefix: v.string(),
    hashedKey: v.string(),
    scopes: v.array(SCOPE),
    createdByUserId: v.string(),
  },
  handler: async (ctx, args) => {
    return ctx.db.insert("apiKeys", {
      businessId: args.businessId,
      name: args.name,
      prefix: args.prefix,
      hashedKey: args.hashedKey,
      scopes: args.scopes,
      createdByUserId: args.createdByUserId,
      createdAt: Date.now(),
    });
  },
});

// The REST auth boundary: resolves a bearer token's hash to its business and
// scopes. Deliberately does not take a businessId — the hash IS the tenant
// lookup, so there is nothing here to scope-check against a caller-supplied id.
export const verifyByHash = query({
  args: { hashedKey: v.string() },
  handler: async (ctx, args) => {
    const key = await ctx.db
      .query("apiKeys")
      .withIndex("by_hashed_key", (q) => q.eq("hashedKey", args.hashedKey))
      .unique();
    if (!key || key.revokedAt) {
      return null;
    }
    return key;
  },
});

export const touchLastUsed = mutation({
  args: { apiKeyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.apiKeyId, { lastUsedAt: Date.now() });
  },
});

// Demonstrates the tenancy contract on a real Phase-1 table: fetching another
// business's api key by id must behave exactly like it doesn't exist.
export const getScopedById = query({
  args: {
    apiKeyId: v.id("apiKeys"),
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<Doc<"apiKeys"> | null> => {
    return getScoped<Doc<"apiKeys">>(ctx.db, args.apiKeyId, args.businessId);
  },
});

export const listByBusiness = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("apiKeys")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});
