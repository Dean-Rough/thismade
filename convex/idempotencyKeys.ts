import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// Internal-only (THI-42): fronted by idempotencyKeysActions.ts for
// lib/api/idempotency.ts's use.
//
// Atomically checks for a prior attempt at this (business, route, key) triple
// and, if none exists, claims it by inserting an "in_progress" row — all
// inside a single Convex mutation, so two concurrent requests with the same
// key can never both observe "no existing record" and both proceed.
export const beginOrReplay = internalMutation({
  args: {
    businessId: v.id("businesses"),
    route: v.string(),
    key: v.string(),
    requestHash: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_business_route_key", (q) =>
        q.eq("businessId", args.businessId).eq("route", args.route).eq("key", args.key),
      )
      .unique();

    if (existing) {
      if (existing.requestHash !== args.requestHash) {
        return { outcome: "conflict" as const };
      }
      if (existing.status === "in_progress") {
        return { outcome: "conflict" as const };
      }
      return {
        outcome: "replay" as const,
        responseStatus: existing.responseStatus ?? 200,
        responseBody: existing.responseBody ?? "",
      };
    }

    const id = await ctx.db.insert("idempotencyKeys", {
      businessId: args.businessId,
      route: args.route,
      key: args.key,
      requestHash: args.requestHash,
      status: "in_progress",
      createdAt: Date.now(),
    });
    return { outcome: "began" as const, id };
  },
});

export const complete = internalMutation({
  args: {
    id: v.id("idempotencyKeys"),
    responseStatus: v.number(),
    responseBody: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, {
      status: "completed",
      responseStatus: args.responseStatus,
      responseBody: args.responseBody,
      completedAt: Date.now(),
    });
  },
});
