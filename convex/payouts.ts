import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const getConnectStatus = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) {
      return null;
    }
    return {
      stripeConnectAccountId: business.stripeConnectAccountId ?? null,
      stripeConnectDetailsSubmitted: business.stripeConnectDetailsSubmitted ?? false,
      stripeConnectChargesEnabled: business.stripeConnectChargesEnabled ?? false,
      stripeConnectPayoutsEnabled: business.stripeConnectPayoutsEnabled ?? false,
    };
  },
});

// Called once, right after creating the Stripe Express account. If the
// business already has an account id (e.g. a retried onboarding-link call),
// the existing id wins — we never swap a business onto a different Connect
// account out from under it.
export const setStripeConnectAccountId = mutation({
  args: {
    businessId: v.id("businesses"),
    stripeConnectAccountId: v.string(),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db.get(args.businessId);
    if (!business) {
      throw new Error("not_found");
    }
    if (!business.stripeConnectAccountId) {
      await ctx.db.patch(args.businessId, {
        stripeConnectAccountId: args.stripeConnectAccountId,
      });
    }
    return ctx.db.get(args.businessId);
  },
});

// Stripe's account.updated webhook carries only the Connect account id, not
// our businessId, so this looks up the owning business via
// by_stripe_connect_account_id instead of taking a businessId directly. An
// account id with no matching business (e.g. a stale or foreign event) is a
// safe no-op, never an error — the webhook endpoint has no way to tell that
// case apart from a delivery race, and both should just be ignored.
export const updateConnectStatusByStripeAccountId = mutation({
  args: {
    stripeConnectAccountId: v.string(),
    detailsSubmitted: v.boolean(),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    const business = await ctx.db
      .query("businesses")
      .withIndex("by_stripe_connect_account_id", (q) =>
        q.eq("stripeConnectAccountId", args.stripeConnectAccountId),
      )
      .unique();
    if (!business) {
      return null;
    }
    await ctx.db.patch(business._id, {
      stripeConnectDetailsSubmitted: args.detailsSubmitted,
      stripeConnectChargesEnabled: args.chargesEnabled,
      stripeConnectPayoutsEnabled: args.payoutsEnabled,
    });
    return ctx.db.get(business._id);
  },
});
