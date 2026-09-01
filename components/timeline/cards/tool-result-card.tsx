import { CheckCircle2, XCircle } from "lucide-react";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

export function ToolResultCard({
  event,
  data,
}: {
  event: AgentEventDoc;
  data: Extract<AgentEventDoc["event"], { kind: "tool_result" }>;
}) {
  return (
    <TimelineCardShell event={event} icon={data.ok ? CheckCircle2 : XCircle} tone={data.ok ? "success" : "danger"}>
      <p className="font-mono text-xs">{data.toolName}</p>
      <p className="mt-1 line-clamp-2 text-ink-muted">{data.resultSummary}</p>
    </TimelineCardShell>
  );
}
