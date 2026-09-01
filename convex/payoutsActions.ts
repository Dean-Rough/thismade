import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc } from "./_generated/dataModel";

type ConnectStatus = {
  stripeConnectAccountId: string | null;
  stripeConnectDetailsSubmitted: boolean;
  stripeConnectChargesEnabled: boolean;
  stripeConnectPayoutsEnabled: boolean;
} | null;

// Public entry points for convex/payouts.ts's internal functions, gated by
// the shared service secret (THI-42).
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const getConnectStatus = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<ConnectStatus> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.payouts.getConnectStatus, args);
  },
});

export const setStripeConnectAccountId = action({
  args: {
    businessId: v.id("businesses"),
    stripeConnectAccountId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"businesses"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.payouts.setStripeConnectAccountId, args);
  },
});

export const updateConnectStatusByStripeAccountId = action({
  args: {
    stripeConnectAccountId: v.string(),
    detailsSubmitted: v.boolean(),
    chargesEnabled: v.boolean(),
    payoutsEnabled: v.boolean(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"businesses"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.payouts.updateConnectStatusByStripeAccountId, args);
  },
});
