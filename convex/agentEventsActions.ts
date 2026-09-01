import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc } from "./_generated/dataModel";

// Public entry points for convex/agentEvents.ts's internal functions, gated
// by the shared service secret (THI-56, same pattern as THI-42).
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const sendChatMessage = action({
  args: {
    businessId: v.id("businesses"),
    authorRole: v.union(v.literal("owner"), v.literal("ceo")),
    text: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<void> => {
    assertServiceSecret(secret);
    await ctx.runMutation(internal.agentEvents.sendChatMessage, args);
  },
});

export const listByBusiness = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentEvents">[]> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.agentEvents.listByBusiness, args);
  },
});

export const listByTask = action({
  args: { businessId: v.id("businesses"), taskId: v.id("agentTasks"), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentEvents">[]> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.agentEvents.listByTask, args);
  },
});

export const listRecentByBusiness = action({
  args: { businessId: v.id("businesses"), limit: v.optional(v.number()), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentEvents">[]> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.agentEvents.listRecentByBusiness, args);
  },
});
