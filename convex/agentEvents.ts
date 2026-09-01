import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getScoped } from "./lib/tenancy";
import { logEvent } from "./lib/events";
import type { Doc } from "./_generated/dataModel";

// The chat surface: owner and CEO both post through this one mutation, and
// every subscriber (chat pane, kanban card detail, audit log) reads the same
// row back over Convex's WS sync via listByBusiness/listByTask — there's no
// separate chat table, chat_message is just another richContent event kind.
export const sendChatMessage = mutation({
  args: {
    businessId: v.id("businesses"),
    authorRole: v.union(v.literal("owner"), v.literal("ceo")),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await logEvent(ctx, {
      businessId: args.businessId,
      actor: args.authorRole,
      event: { kind: "chat_message", authorRole: args.authorRole, text: args.text },
      createdAt: now,
    });
  },
});

export const listByBusiness = query({
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
export const listByTask = query({
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
