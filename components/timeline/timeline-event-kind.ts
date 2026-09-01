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
