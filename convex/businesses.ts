import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// Every function below is internal-only (THI-42): none of these are meant to
// be reachable from the public Convex HTTP API. `getSelf`/`updateCheckoutReturnUrl`
// are fronted by a secret-gated public action in businessesActions.ts for the
// /v1 REST layer; `create` is fronted too, but only for operator/test tooling
// (no signup flow exists yet). `listByOwner` has no action wrapper because
// nothing calls it yet — only convex-test's internal.businesses.listByOwner
// exercises it today.
export const create = internalMutation({
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
export const getSelf = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db.get(args.businessId);
  },
});

export const updateCheckoutReturnUrl = internalMutation({
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

export const listByOwner = internalQuery({
  args: { ownerUserId: v.string() },
  handler: async (ctx, args) => {
    return ctx.db
      .query("businesses")
      .withIndex("by_owner_user_id", (q) => q.eq("ownerUserId", args.ownerUserId))
      .collect();
  },
});
