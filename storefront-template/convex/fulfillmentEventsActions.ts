import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc, Id } from "./_generated/dataModel";

// Public entry points for convex/fulfillmentEvents.ts's internal functions.
// Each action exists only to check the shared service secret (THI-53) before
// delegating — the record/list logic itself is unchanged and still lives in
// the internal function. `record` is called by app/api/fulfillment/route.ts
// only after that route's own HMAC signature check passes; `list` is for the
// future /admin-gated read path (nothing calls it yet).
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const record = action({
  args: {
    externalOrderId: v.string(),
    payload: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Id<"fulfillmentEvents">> => {
    await assertServiceSecret(secret);
    return ctx.runMutation(internal.fulfillmentEvents.record, args);
  },
});

export const list = action({
  args: { secret: v.string() },
  handler: async (ctx, { secret }): Promise<Doc<"fulfillmentEvents">[]> => {
    await assertServiceSecret(secret);
    return ctx.runQuery(internal.fulfillmentEvents.list, {});
  },
});
