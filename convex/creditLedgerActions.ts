import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";

// Public entry points for convex/creditLedger.ts's internal functions,
// gated by the shared service secret (THI-56, same pattern as THI-42).
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const getBalance = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<number> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.creditLedger.getBalance, args);
  },
});

export const grant = action({
  args: { businessId: v.id("businesses"), amount: v.number(), reason: v.string(), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<number> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.creditLedger.grant, args);
  },
});

export const spend = action({
  args: {
    businessId: v.id("businesses"),
    amount: v.number(),
    reason: v.string(),
    idempotencyKey: v.string(),
    taskId: v.optional(v.id("agentTasks")),
    secret: v.string(),
  },
  handler: async (
    ctx,
    { secret, ...args },
  ): Promise<{
    balanceAfter: number;
    replayed: boolean;
    transactionId?: string;
    eventId?: string;
  }> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.creditLedger.spend, args);
  },
});
