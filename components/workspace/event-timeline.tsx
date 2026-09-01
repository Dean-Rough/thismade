import type { Id } from "@/convex/_generated/dataModel";
import { TimelineEvent, type LivePendingApproval } from "@/components/timeline/timeline-event";
import type { AgentEventDoc } from "@/lib/api/dashboardTimeline";
import { groupByDay } from "./group-by-day";

export function EventTimeline({
  events,
  pendingApprovals,
}: {
  events: AgentEventDoc[];
  pendingApprovals: ReadonlyMap<Id<"agentTasks">, LivePendingApproval>;
}) {
  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center text-sm text-ink-muted">
        No activity yet — send a message below or dispatch a task to get started.
      </div>
    );
  }

  const sorted = [...events].sort((a, b) => a.createdAt - b.createdAt);
  const groups = groupByDay(sorted, (event) => event.createdAt, Date.now());

  return (
    <div className="space-y-6 p-4">
      {groups.map((group) => (
        <div key={group.dateKey} className="space-y-2">
          <div className="sticky top-0 z-10 flex items-center gap-2 bg-surface py-1 text-xs font-medium text-ink-muted">
            <span className="h-px flex-1 bg-border" />
            {group.label}
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className="space-y-2">
            {group.items.map((event) => (
              <TimelineEvent key={event._id} event={event} pendingApprovals={pendingApprovals} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
