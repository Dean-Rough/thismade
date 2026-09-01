import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { getScoped } from "./lib/tenancy";
import type { Doc, Id } from "./_generated/dataModel";

const SCOPE = v.union(
  v.literal("read"),
  v.literal("write"),
  v.literal("money"),
  v.literal("ads"),
);

// Internal-only (THI-42): verifyByHash/touchLastUsed are fronted by
// apiKeysActions.ts for lib/api/auth.ts's use. `create` is fronted too, but
// only for operator/test tooling (no key-issuance flow exists yet).
// getScopedById/listByBusiness have no action wrapper — nothing calls them
// yet.
export const create = internalMutation({
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
export const verifyByHash = internalQuery({
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

export const touchLastUsed = internalMutation({
  args: { apiKeyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.apiKeyId, { lastUsedAt: Date.now() });
  },
});

// Demonstrates the tenancy contract on a real Phase-1 table: fetching another
// business's api key by id must behave exactly like it doesn't exist.
export const getScopedById = internalQuery({
  args: {
    apiKeyId: v.id("apiKeys"),
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<Doc<"apiKeys"> | null> => {
    return getScoped<Doc<"apiKeys">>(ctx.db, args.apiKeyId, args.businessId);
  },
});

export const listByBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("apiKeys")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});
