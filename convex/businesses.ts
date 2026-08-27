import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    name: v.string(),
    slug: v.string(),
    ownerUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("businesses")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (existing) {
      throw new Error("slug_taken");
    }
    return ctx.db.insert("businesses", {
      name: args.name,
      slug: args.slug,
      ownerUserId: args.ownerUserId,
      lifecycleStatus: "active",
      createdAt: Date.now(),
    });
  },
});

// Returns the caller's own business, or null. There is no cross-business
// lookup by design: /v1/business always resolves "the business behind this
// API key," so there is no id parameter for a caller to probe with.
export const getSelf = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.businessId);
  },
});

export const updateCheckoutReturnUrl = mutation({
  args: {
    businessId: v.id("businesses"),
    checkoutReturnUrl: v.string(),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) {
      throw new Error("not_found");
    }
    await ctx.db.patch(args.businessId, {
      checkoutReturnUrl: args.checkoutReturnUrl,
    });
    return ctx.db.get(args.businessId);
  },
});

export const listByOwner = query({
  args: { ownerUserId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("businesses")
      .withIndex("by_owner_user_id", (q) => q.eq("ownerUserId", args.ownerUserId))
      .collect();
  },
});
