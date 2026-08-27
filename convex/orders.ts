import { v } from "convex/values";
import { mutation } from "./_generated/server";

// Called from the Stripe webhook (checkout.session.completed) to record a
// paid order. Stripe can redeliver the same event (retry after a timeout, a
// manual resend from the dashboard), so this is a check-then-insert keyed on
// stripeCheckoutSessionId — the same intra-mutation check-and-claim idiom as
// idempotencyKeys.beginOrReplay — rather than a blind insert. Convex runs a
// mutation's reads and writes as one transaction with optimistic concurrency
// control, so two concurrent deliveries can't both observe "no existing row"
// and both insert.
export const createFromCheckoutSession = mutation({
  args: {
    businessId: v.id("businesses"),
    productId: v.id("products"),
    customerEmail: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    stripeCheckoutSessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("orders")
      .withIndex("by_stripe_session", (q) =>
        q.eq("stripeCheckoutSessionId", args.stripeCheckoutSessionId),
      )
      .unique();
    if (existing) {
      return existing;
    }

    const id = await ctx.db.insert("orders", {
      businessId: args.businessId,
      productId: args.productId,
      customerEmail: args.customerEmail,
      amountCents: args.amountCents,
      currency: args.currency,
      status: "paid",
      stripeCheckoutSessionId: args.stripeCheckoutSessionId,
      createdAt: Date.now(),
    });
    return ctx.db.get(id);
  },
});
