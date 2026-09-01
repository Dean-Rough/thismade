import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc } from "./_generated/dataModel";

const STATUS = v.union(v.literal("active"), v.literal("draft"), v.literal("archived"));

// Public entry points for convex/products.ts's internal functions, gated by
// the shared service secret (THI-42).
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const create = action({
  args: {
    businessId: v.id("businesses"),
    title: v.string(),
    description: v.string(),
    priceAmountCents: v.number(),
    currency: v.string(),
    deliverableFileUrl: v.optional(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"products"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.products.create, args);
  },
});

export const getScopedById = action({
  args: {
    productId: v.id("products"),
    businessId: v.id("businesses"),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"products"> | null> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.products.getScopedById, args);
  },
});

export const update = action({
  args: {
    businessId: v.id("businesses"),
    productId: v.id("products"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priceAmountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    status: v.optional(STATUS),
    deliverableFileUrl: v.optional(v.string()),
    stripeProductId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"products"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.products.update, args);
  },
});

export const listByBusiness = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"products">[]> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.products.listByBusiness, args);
  },
});
