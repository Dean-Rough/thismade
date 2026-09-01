import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc } from "./_generated/dataModel";

const WORKER_TYPE = v.union(
  v.literal("coding"),
  v.literal("browser"),
  v.literal("marketing"),
);

const STATUS = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("needs_review"),
  v.literal("done"),
);

const ACTOR = v.union(
  v.literal("owner"),
  v.literal("ceo"),
  v.literal("worker"),
  v.literal("system"),
);

// Public entry points for convex/agentTasks.ts's internal functions, gated
// by the shared service secret (THI-56, same pattern as THI-42).
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
export const dispatch = action({
  args: {
    businessId: v.id("businesses"),
    title: v.string(),
    description: v.string(),
    workerType: WORKER_TYPE,
    dispatchKey: v.string(),
    instructions: v.string(),
    containsUntrustedContent: v.boolean(),
    creditCost: v.number(),
    maxAttempts: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentTasks"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.agentTasks.dispatch, args);
  },
});

export const getScopedById = action({
  args: {
    taskId: v.id("agentTasks"),
    businessId: v.id("businesses"),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentTasks"> | null> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.agentTasks.getScopedById, args);
  },
});

export const listByBusiness = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentTasks">[]> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.agentTasks.listByBusiness, args);
  },
});

export const listByStatus = action({
  args: { businessId: v.id("businesses"), status: STATUS, secret: v.string() },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentTasks">[]> => {
    assertServiceSecret(secret);
    return ctx.runQuery(internal.agentTasks.listByStatus, args);
  },
});

export const advanceStatus = action({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
    toStatus: STATUS,
    actor: ACTOR,
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentTasks"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.agentTasks.advanceStatus, args);
  },
});

export const recordAttemptFailure = action({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
    errorMessage: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentTasks"> | null> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.agentTasks.recordAttemptFailure, args);
  },
});
