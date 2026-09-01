import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { getScoped } from "./lib/tenancy";
import { logEvent } from "./lib/events";
import type { Doc } from "./_generated/dataModel";

// Blast-radius cap (THI-62): an owner's chat text is exactly the kind of
// lower-trust input the CEO orchestrator may later fold into a worker's
// `instructions` (agentTasks.dispatch), so this table is itself part of the
// prompt-injection trust boundary, not just an audit log. A length limit
// doesn't neutralize injected content, but it bounds how much of it a
// single message can carry.
const MAX_CHAT_TEXT_LENGTH = 4_000;

// Internal-only (THI-56): every function here is fronted by the matching
// action in agentEventsActions.ts, same pattern as THI-42.
//
// The chat surface: owner and CEO both post through this one mutation, and
// every subscriber (chat pane, kanban card detail, audit log) reads the same
// row back over Convex's WS sync via listByBusiness/listByTask — there's no
// separate chat table, chat_message is just another richContent event kind.
export const sendChatMessage = internalMutation({
  args: {
    businessId: v.id("businesses"),
    authorRole: v.union(v.literal("owner"), v.literal("ceo")),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.text.length === 0 || args.text.length > MAX_CHAT_TEXT_LENGTH) {
      throw new Error("invalid_text_length");
    }
    const now = Date.now();
    await logEvent(ctx, {
      businessId: args.businessId,
      actor: args.authorRole,
      event: { kind: "chat_message", authorRole: args.authorRole, text: args.text },
      createdAt: now,
    });
  },
});

export const listByBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agentEvents")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

// Cross-tenant tasks resolve as "no events" rather than an error — the same
// 404-shaped silence as getScoped, just expressed as an empty list since
// this is a list endpoint.
export const listByTask = internalQuery({
  args: { businessId: v.id("businesses"), taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    const task = await getScoped<Doc<"agentTasks">>(ctx.db, args.taskId, args.businessId);
    if (!task) {
      return [];
    }
    return ctx.db
      .query("agentEvents")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .collect();
  },
});
