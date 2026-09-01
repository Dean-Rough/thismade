import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc } from "./_generated/dataModel";

// Public entry points for convex/agentSkills.ts's internal functions, gated
// by the shared service secret (THI-42, extended per THI-55 review).
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const get = action({
  args: { businessId: v.id("businesses"), skillKey: v.string(), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentSkills"> | null> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.agentSkills.get, args);
  },
});

export const listByBusiness = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentSkills">[]> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.agentSkills.listByBusiness, args);
  },
});

export const upsert = action({
  args: {
    businessId: v.id("businesses"),
    skillKey: v.string(),
    content: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentSkills"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.agentSkills.upsert, args);
  },
});
