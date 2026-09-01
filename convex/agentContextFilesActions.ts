import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc } from "./_generated/dataModel";

const FILE_KEY = v.union(
  v.literal("SOUL"),
  v.literal("OWNER"),
  v.literal("BUSINESS"),
  v.literal("PLATFORM"),
  v.literal("PLAYBOOK"),
  v.literal("RUNBOOK"),
  v.literal("MEMORY"),
  v.literal("CODE_MAP"),
);

// Public entry points for convex/agentContextFiles.ts's internal functions,
// gated by the shared service secret (THI-56, same pattern as THI-42).
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const get = action({
  args: { businessId: v.id("businesses"), fileKey: FILE_KEY, secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentContextFiles"> | null> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.agentContextFiles.get, args);
  },
});

export const listByBusiness = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentContextFiles">[]> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.agentContextFiles.listByBusiness, args);
  },
});

export const upsert = action({
  args: {
    businessId: v.id("businesses"),
    fileKey: FILE_KEY,
    content: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentContextFiles"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.agentContextFiles.upsert, args);
  },
});
