import { ShieldCheck, ShieldX } from "lucide-react";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

export function ToolCallApprovalDecisionCard({
  event,
  data,
}: {
  event: AgentEventDoc;
  data: Extract<AgentEventDoc["event"], { kind: "tool_call_approval_decision" }>;
}) {
  const approved = data.decision === "approved";
  return (
    <TimelineCardShell
      event={event}
      icon={approved ? ShieldCheck : ShieldX}
      tone={approved ? "success" : "danger"}
    >
      <p className="font-mono text-xs">{data.toolName}</p>
      <p className="mt-1">{approved ? "Approved" : "Rejected"}</p>
    </TimelineCardShell>
  );
}
