import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc } from "./_generated/dataModel";

// Public entry points for convex/orders.ts's internal functions, gated by
// the shared service secret (THI-42).
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const createFromCheckoutSession = action({
  args: {
    businessId: v.id("businesses"),
    productId: v.id("products"),
    customerEmail: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    stripeCheckoutSessionId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"orders"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.orders.createFromCheckoutSession, args);
  },
});

export const getScopedById = action({
  args: {
    orderId: v.id("orders"),
    businessId: v.id("businesses"),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"orders"> | null> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.orders.getScopedById, args);
  },
});

export const listByBusiness = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"orders">[]> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.orders.listByBusiness, args);
  },
});

export const markRefunded = action({
  args: {
    businessId: v.id("businesses"),
    orderId: v.id("orders"),
    refundedAt: v.number(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"orders"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.orders.markRefunded, args);
  },
});

export const markShipped = action({
  args: {
    businessId: v.id("businesses"),
    orderId: v.id("orders"),
    shippedAt: v.number(),
    trackingCode: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"orders"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.orders.markShipped, args);
  },
});
