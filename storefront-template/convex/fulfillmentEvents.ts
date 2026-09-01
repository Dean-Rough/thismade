import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const record = mutation({
  args: {
    externalOrderId: v.string(),
    payload: v.string(),
  },
  handler: async (ctx, args) => {
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
