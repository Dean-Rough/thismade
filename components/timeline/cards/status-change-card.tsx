import { ArrowRight } from "lucide-react";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

export function StatusChangeCard({
  event,
  data,
}: {
  event: AgentEventDoc;
  data: Extract<AgentEventDoc["event"], { kind: "status_change" }>;
}) {
  return (
    <TimelineCardShell event={event} icon={ArrowRight}>
      <p className="flex items-center gap-1.5 font-mono text-xs">
        <span className="rounded bg-surface px-1.5 py-0.5">{data.fromStatus}</span>
        <ArrowRight className="size-3 text-ink-muted" />
        <span className="rounded bg-surface px-1.5 py-0.5">{data.toStatus}</span>
      </p>
    </TimelineCardShell>
  );
}
