import { AlertTriangle } from "lucide-react";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

export function ErrorCard({
  event,
  data,
}: {
  event: AgentEventDoc;
  data: Extract<AgentEventDoc["event"], { kind: "error" }>;
}) {
  return (
    <TimelineCardShell event={event} icon={AlertTriangle} tone="danger">
      <p className="whitespace-pre-wrap text-confirmation-rejected">{data.message}</p>
    </TimelineCardShell>
  );
}
