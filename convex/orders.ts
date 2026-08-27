import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getScoped } from "./lib/tenancy";
import type { Doc } from "./_generated/dataModel";

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

// The tenancy contract on the orders table: a different business asking for
// the same id gets null, indistinguishable from a nonexistent id. The REST
// layer turns this into a plain 404, never a 403. Mirrors
// products.getScopedById.
export const getScopedById = query({
  args: {
    orderId: v.id("orders"),
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<Doc<"orders"> | null> => {
    return getScoped<Doc<"orders">>(ctx.db, args.orderId, args.businessId);
  },
});

export const listByBusiness = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("orders")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

// Persists a refund already issued against Stripe. The REST layer
// (app/v1/orders/[id]/refund/route.ts) fetches the order first via
// getScopedById and rejects an already-refunded order with
// `refund_already_issued` before this mutation ever runs and before Stripe
// is called again — see DECISIONS.md §orders. This mutation only re-checks
// tenancy, matching products.update's shape.
export const markRefunded = mutation({
  args: {
    businessId: v.id("businesses"),
    orderId: v.id("orders"),
    refundedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await getScoped<Doc<"orders">>(ctx.db, args.orderId, args.businessId);
    if (!existing) {
      return null;
    }
    await ctx.db.patch(args.orderId, { status: "refunded", refundedAt: args.refundedAt });
    return ctx.db.get(args.orderId);
  },
});

// shippedAt/shippingTrackingCode are independent of status/refundedAt — a
// refunded order can still be marked shipped (see DECISIONS.md §orders). The
// REST layer rejects a double-ship (existing.shippedAt already set) before
// calling this mutation.
export const markShipped = mutation({
  args: {
    businessId: v.id("businesses"),
    orderId: v.id("orders"),
    shippedAt: v.number(),
    trackingCode: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await getScoped<Doc<"orders">>(ctx.db, args.orderId, args.businessId);
    if (!existing) {
      return null;
    }
    await ctx.db.patch(args.orderId, {
      shippedAt: args.shippedAt,
      shippingTrackingCode: args.trackingCode,
    });
    return ctx.db.get(args.orderId);
  },
});
