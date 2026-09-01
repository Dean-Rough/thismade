import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";

// Public entry point for convex/seedAgentContext.ts's internal action,
// gated by the shared service secret (THI-42, extended per THI-55 review).
//
// The explicit return type annotation below breaks a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const seedDefaults = action({
  args: {
    businessId: v.id("businesses"),
    ownerName: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    offerSummary: v.optional(v.string()),
    targetAudience: v.optional(v.string()),
    provisionedAtIso: v.string(),
    secret: v.string(),
  },
  handler: async (
    ctx,
    { secret, ...args },
  ): Promise<{ businessId: string; fileKeys: readonly string[]; skillKeys: string[] }> => {
    assertServiceSecret(secret);
    return ctx.runAction(internal.seedAgentContext.seedDefaults, args);
  },
});
