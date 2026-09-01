import type { Id } from "@/convex/_generated/dataModel";
import { ChatMessageCard } from "./cards/chat-message-card";
import { CreditDebitCard } from "./cards/credit-debit-card";
import { DispatchCard } from "./cards/dispatch-card";
import { ErrorCard } from "./cards/error-card";
import { FileDiffCard } from "./cards/file-diff-card";
import { StatusChangeCard } from "./cards/status-change-card";
import { ToolCallApprovalDecisionCard } from "./cards/tool-call-approval-decision-card";
import { ToolCallCard } from "./cards/tool-call-card";
import { ToolCallPendingApprovalCard } from "./cards/tool-call-pending-approval-card";
import { ToolResultCard } from "./cards/tool-result-card";
import { UnknownEventCard } from "./cards/unknown-event-card";
import { resolveTimelineCardKind, type AgentEventDoc } from "./timeline-event-kind";

// The catalogue switch THI-17 asks for: one component per richContent.type,
// with a visible fallback that never crashes on an unhandled kind. See
// timeline-event-kind.ts / timeline-event-kind.test.ts for the runtime guard
// this leans on, and DECISIONS.md for why the kind vocabulary here doesn't
// match THI-14's originally-planned type names.
export function TimelineEvent({
  event,
  pendingTaskIds,
}: {
  event: AgentEventDoc;
  pendingTaskIds: ReadonlySet<Id<"agentTasks">>;
}) {
  if (resolveTimelineCardKind(event.event) === "unknown") {
    return <UnknownEventCard event={event} />;
  }

  const data = event.event;
  switch (data.kind) {
    case "chat_message":
      return <ChatMessageCard event={event} data={data} />;
    case "dispatch":
      return <DispatchCard event={event} data={data} />;
    case "status_change":
      return <StatusChangeCard event={event} data={data} />;
    case "tool_call":
      return <ToolCallCard event={event} data={data} />;
    case "tool_result":
      return <ToolResultCard event={event} data={data} />;
    case "file_diff":
      return <FileDiffCard event={event} data={data} />;
    case "credit_debit":
      return <CreditDebitCard event={event} data={data} />;
    case "error":
      return <ErrorCard event={event} data={data} />;
    case "tool_call_pending_approval":
      return (
        <ToolCallPendingApprovalCard
          event={event}
          data={data}
          isStillPending={pendingTaskIds.has(data.taskId)}
        />
      );
    case "tool_call_approval_decision":
      return <ToolCallApprovalDecisionCard event={event} data={data} />;
    default:
      // Unreachable given the guard above — kept as a second line of
      // defense against future schema drift, per THI-17's "never a crash".
      return <UnknownEventCard event={event} />;
  }
}
