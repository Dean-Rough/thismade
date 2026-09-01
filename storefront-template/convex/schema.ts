import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Records each accepted /api/fulfillment call. HMAC verification happens
  // in the route handler before this table is ever written to — a row here
  // means the signature already checked out.
  fulfillmentEvents: defineTable({
    externalOrderId: v.string(),
    payload: v.string(),
    receivedAt: v.number(),
  }).index("by_external_order_id", ["externalOrderId"]),
});
