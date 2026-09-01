import { HelpCircle } from "lucide-react";
import { TimelineCardShell } from "../card-shell";
import type { AgentEventDoc } from "../timeline-event-kind";

// The required fallback for any richContent kind this build doesn't (or
// doesn't yet) have a dedicated card for — THI-17 acceptance criteria: "a
// visible unknown event fallback for unhandled types, never a crash."
export function UnknownEventCard({ event }: { event: AgentEventDoc }) {
  return (
    <TimelineCardShell event={event} icon={HelpCircle}>
      <p className="text-ink-muted">
        Unrecognized event type <span className="font-mono">{event.event.kind}</span>
      </p>
    </TimelineCardShell>
  );
}
