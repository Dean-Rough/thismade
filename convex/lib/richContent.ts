import { v } from "convex/values";

// The agent timeline's typed event union — every UI surface (chat, kanban
// card detail, audit log) reads this instead of regexing free-text logs.
// Each variant is its own object shape so a reader can switch on `kind` and
// get real field types back, not a loosely-typed payload blob.
export const chatMessageEvent = v.object({
  kind: v.literal("chat_message"),
  authorRole: v.union(v.literal("owner"), v.literal("ceo")),
  text: v.string(),
});

export const dispatchEvent = v.object({
  kind: v.literal("dispatch"),
  taskId: v.id("agentTasks"),
  workerType: v.union(
    v.literal("coding"),
    v.literal("browser"),
    v.literal("marketing"),
  ),
  instructions: v.string(),
  // Trust-boundary tag (THI-62): whether the dispatcher is declaring these
  // instructions as its own, or as embedding lower-trust input (a chat
  // message, catalog copy, a webhook payload). Carried onto the event so
  // the audit trail — and eventually a worker's prompt assembler — never
  // has to guess provenance after the fact.
  containsUntrustedContent: v.boolean(),
});

export const statusChangeEvent = v.object({
  kind: v.literal("status_change"),
  taskId: v.id("agentTasks"),
  fromStatus: v.string(),
  toStatus: v.string(),
});

export const toolCallEvent = v.object({
  kind: v.literal("tool_call"),
  taskId: v.id("agentTasks"),
  toolName: v.string(),
  argsSummary: v.string(),
});

export const toolResultEvent = v.object({
  kind: v.literal("tool_result"),
  taskId: v.id("agentTasks"),
  toolName: v.string(),
  ok: v.boolean(),
  resultSummary: v.string(),
});

export const fileDiffEvent = v.object({
  kind: v.literal("file_diff"),
  taskId: v.id("agentTasks"),
  path: v.string(),
  diffSummary: v.string(),
});

export const creditDebitEvent = v.object({
  kind: v.literal("credit_debit"),
  taskId: v.optional(v.id("agentTasks")),
  amount: v.number(),
  balanceAfter: v.number(),
  reason: v.string(),
});

export const errorEvent = v.object({
  kind: v.literal("error"),
  taskId: v.optional(v.id("agentTasks")),
  message: v.string(),
});

export const richContentEvent = v.union(
  chatMessageEvent,
  dispatchEvent,
  statusChangeEvent,
  toolCallEvent,
  toolResultEvent,
  fileDiffEvent,
  creditDebitEvent,
  errorEvent,
);
