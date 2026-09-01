import { Send } from "lucide-react";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

export function DispatchCard({
  event,
  data,
}: {
  event: AgentEventDoc;
  data: Extract<AgentEventDoc["event"], { kind: "dispatch" }>;
}) {
  return (
    <TimelineCardShell event={event} icon={Send}>
      <p>
        Dispatched a <span className="font-medium">{data.workerType}</span> worker.
        {data.containsUntrustedContent && (
          <span className="ml-2 rounded-full bg-confirmation-pending/15 px-2 py-0.5 text-xs text-confirmation-pending">
            untrusted content
          </span>
        )}
      </p>
      <p className="mt-1 line-clamp-3 text-ink-muted">{data.instructions}</p>
    </TimelineCardShell>
  );
}
