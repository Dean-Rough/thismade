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

// THI-66: the worker loop paused instead of executing a destructive tool
// call (see workerTools.ts's isDestructiveToolCall) — distinct from
// errorEvent so a gated call reads on the timeline as "waiting for a
// decision," not as a failure.
//
// THI-91: argsHash carries the same full-fidelity binding
// convex/lib/workerLoop.ts's hashToolArgs computes for task.pendingApproval,
// so a UI caller resolving this exact event can prove to
// agentTasks.resolveToolApproval that it's deciding the call this card
// displays — not just whatever the task's current live pendingApproval
// happens to be (toolName + argsSummary text can collide between two
// distinct pending calls; this can't).
export const toolCallPendingApprovalEvent = v.object({
  kind: v.literal("tool_call_pending_approval"),
  taskId: v.id("agentTasks"),
  toolName: v.string(),
  argsSummary: v.string(),
  argsHash: v.string(),
});

// THI-66: the owner/CEO's decision on a tool_call_pending_approval event —
// logged by agentTasks.resolveToolApproval, actor is always "owner" or
// "ceo" (that mutation's arg validator rejects anything else).
export const toolCallApprovalDecisionEvent = v.object({
  kind: v.literal("tool_call_approval_decision"),
  taskId: v.id("agentTasks"),
  toolName: v.string(),
  decision: v.union(v.literal("approved"), v.literal("denied")),
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
  toolCallPendingApprovalEvent,
  toolCallApprovalDecisionEvent,
);
