import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const record = mutation({
  args: {
    externalOrderId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("fulfillmentEvents")
      .withIndex("by_external_order_id", (q) =>
        q.eq("externalOrderId", args.externalOrderId),
      )
      .first();
    if (existing) {
      // Replay within the HMAC signature's tolerance window: no-op instead
      // of inserting a duplicate row for the same externalOrderId.
      return existing._id;
    }

    return ctx.db.insert("fulfillmentEvents", {
      externalOrderId: args.externalOrderId,
      payload: args.payload,
      receivedAt: Date.now(),
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("fulfillmentEvents").order("desc").take(50);
  },
});
