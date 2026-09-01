import { Terminal } from "lucide-react";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

export function ToolCallCard({
  event,
  data,
}: {
  event: AgentEventDoc;
  data: Extract<AgentEventDoc["event"], { kind: "tool_call" }>;
}) {
  return (
    <TimelineCardShell event={event} icon={Terminal}>
      <p className="font-mono text-xs">{data.toolName}</p>
      <p className="mt-1 line-clamp-2 text-ink-muted">{data.argsSummary}</p>
    </TimelineCardShell>
  );
}
