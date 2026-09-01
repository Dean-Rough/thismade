import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

// THI-53: internal-only (unreachable from the public Convex HTTP API) so
// that the HMAC boundary in app/api/fulfillment/route.ts and the /admin JWT
// gate remain the only ways in. Public entry points live in
// fulfillmentEventsActions.ts, gated by the shared secret in
// convex/lib/serviceAuth.ts.
export const record = internalMutation({
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

export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    return ctx.db.query("fulfillmentEvents").order("desc").take(50);
  },
});
