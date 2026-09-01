import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Id } from "./_generated/dataModel";

type BeginOrReplayResult =
  | { outcome: "conflict" }
  | { outcome: "replay"; responseStatus: number; responseBody: string }
  | { outcome: "began"; id: Id<"idempotencyKeys"> };

// Public entry points for convex/idempotencyKeys.ts's internal functions,
// gated by the shared service secret (THI-42).
//
// The explicit return type annotation below breaks a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const beginOrReplay = action({
  args: {
    businessId: v.id("businesses"),
    route: v.string(),
    key: v.string(),
    requestHash: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<BeginOrReplayResult> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.idempotencyKeys.beginOrReplay, args);
  },
});

export const complete = action({
  args: {
    id: v.id("idempotencyKeys"),
    responseStatus: v.number(),
    responseBody: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }) => {
    assertServiceSecret(secret);
    await ctx.runMutation(internal.idempotencyKeys.complete, args);
  },
});
