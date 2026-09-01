import { FileDiff } from "lucide-react";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

export function FileDiffCard({
  event,
  data,
}: {
  event: AgentEventDoc;
  data: Extract<AgentEventDoc["event"], { kind: "file_diff" }>;
}) {
  return (
    <TimelineCardShell event={event} icon={FileDiff}>
      <p className="font-mono text-xs">{data.path}</p>
      <p className="mt-1 line-clamp-3 text-ink-muted">{data.diffSummary}</p>
    </TimelineCardShell>
  );
}
