import { ShieldAlert } from "lucide-react";
import { PendingApprovalContent } from "@/components/approvals/pending-approval-content";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

export function ToolCallPendingApprovalCard({
  event,
  data,
  isStillPending,
}: {
  event: AgentEventDoc;
  data: Extract<AgentEventDoc["event"], { kind: "tool_call_pending_approval" }>;
  // Whether the referenced task's agentTasks.pendingApproval still matches
  // this event — the event row itself is an immutable log entry, so "is this
  // still awaiting a decision" has to be read off the live task, not here.
  isStillPending: boolean;
}) {
  return (
    <TimelineCardShell event={event} icon={ShieldAlert} tone="warning">
      <PendingApprovalContent
        taskId={data.taskId}
        toolName={data.toolName}
        argsSummary={data.argsSummary}
        argsHash={data.argsHash}
        isStillPending={isStillPending}
      />
    </TimelineCardShell>
  );
}
