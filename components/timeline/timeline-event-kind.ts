import type { Doc } from "@/convex/_generated/dataModel";

// The full, closed vocabulary convex/lib/richContent.ts actually implements.
// THI-14's plan named a different set of richContent.type values (briefing,
// task_dispatch, milestone, owner_secret_request, workspace_file,
// suggestion_chips, blueprint, brand_kit, landing_page, ...) captured from
// MadeThis — DECISIONS.md's Phase 3 entry records that this was a deliberate
// rename, not a drift to fix: "same structural idea, original naming." This
// switch is keyed on the real wire vocabulary below, with every name outside
// it — including THI-14's own list — falling through to "unknown".
export const KNOWN_TIMELINE_EVENT_KINDS = [
  "chat_message",
  "dispatch",
  "status_change",
  "tool_call",
  "tool_result",
  "file_diff",
  "credit_debit",
  "error",
  "tool_call_pending_approval",
  "tool_call_approval_decision",
] as const;

export type KnownTimelineEventKind = (typeof KNOWN_TIMELINE_EVENT_KINDS)[number];
export type TimelineCardKind = KnownTimelineEventKind | "unknown";

// Loosely typed on purpose: this guards against a *runtime* payload that
// doesn't match the compile-time richContentEvent union (a future backend
// kind this build hasn't shipped a card for yet, a malformed row, a schema
// drift bug) — an exact `Doc<"agentEvents">["event"]` parameter would let
// TypeScript "prove" the fallback branch is unreachable and defeat the point
// of having one. See timeline-event-kind.test.ts.
export function resolveTimelineCardKind(event: { kind: string }): TimelineCardKind {
  return (KNOWN_TIMELINE_EVENT_KINDS as readonly string[]).includes(event.kind)
    ? (event.kind as KnownTimelineEventKind)
    : "unknown";
}

export type AgentEventDoc = Doc<"agentEvents">;

// A task can pause on a destructive tool call, get approved, resume, and
// pause again on a *different* call — each pause appends its own immutable
// tool_call_pending_approval event (convex/lib/workerLoop.ts logs one per
// pause; convex/agentTasks.ts's requestToolApproval comments confirm a
// resumed run can hit a second gate). Matching "is this event's task
// currently pending" on taskId alone lets a stale event (an earlier,
// already-resolved pause) render live Confirm/Reject buttons again once the
// task pauses a second time — approving it would resolve whatever the task's
// *current* pendingApproval is, not the tool call the card displays. Matching
// on toolName + argsSummary too closes that: two consecutive pauses on the
// literal same tool + same summary are the one case this can't distinguish,
// which is also the one case where approving either reads as the same
// decision to a human.
export function isPendingApprovalLive(
  event: { toolName: string; argsSummary: string },
  pendingApproval: { toolName: string; argsSummary: string } | undefined,
): boolean {
  return (
    pendingApproval !== undefined &&
    pendingApproval.toolName === event.toolName &&
    pendingApproval.argsSummary === event.argsSummary
  );
}
