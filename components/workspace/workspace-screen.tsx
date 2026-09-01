"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
import type { LivePendingApproval } from "@/components/timeline/timeline-event";
import type { AgentEventDoc, AgentTaskDoc } from "@/lib/api/dashboardTimeline";
import { computeLaunchPlan } from "@/lib/launch-plan";
import { Composer } from "./composer";
import { EventTimeline } from "./event-timeline";
import { LaunchPlanWidget } from "./launch-plan-widget";
import { TaskBoard } from "./task-board";

const POLL_INTERVAL_MS = 4_000;
const NEAR_BOTTOM_THRESHOLD_PX = 80;

export function WorkspaceScreen({
  businessId,
  initialEvents,
  initialTasks,
  businessCreatedAt,
  contextFileKeys,
  hasSkill,
}: {
  businessId: Id<"businesses">;
  initialEvents: AgentEventDoc[];
  initialTasks: AgentTaskDoc[];
  businessCreatedAt: number;
  contextFileKeys: string[];
  hasSkill: boolean;
}) {
  const [events, setEvents] = useState(initialEvents);
  const [tasks, setTasks] = useState(initialTasks);
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/timeline");
      if (!res.ok) return;
      const data: { events: AgentEventDoc[]; tasks: AgentTaskDoc[] } = await res.json();
      // Only replace state (and re-render/re-trigger auto-scroll) when the
      // poll actually returned something different — otherwise every 4s tick
      // would snap a reader back to the bottom even with zero new activity.
      setEvents((prev) => (JSON.stringify(prev) === JSON.stringify(data.events) ? prev : data.events));
      setTasks((prev) => (JSON.stringify(prev) === JSON.stringify(data.tasks) ? prev : data.tasks));
    } catch {
      // Transient network hiccup — next poll tick retries; the dashboard
      // has no other liveness signal to fall back to.
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(refetch, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refetch]);

  // Auto-scroll on new events (THI-17), but only if the reader was already
  // near the bottom — otherwise a background event would yank them away
  // from history they're actively scrolled up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && wasNearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [events]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    wasNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_THRESHOLD_PX;
  }

  // Keyed by taskId, holding each task's *current* pendingApproval — see
  // components/timeline/timeline-event-kind.ts's isPendingApprovalLive for
  // why this can't just be "which task ids have one" (THI-89).
  const pendingApprovals = useMemo(() => {
    const map = new Map<Id<"agentTasks">, LivePendingApproval>();
    for (const task of tasks) {
      if (task.pendingApproval) {
        map.set(task._id, {
          toolName: task.pendingApproval.toolName,
          argsSummary: task.pendingApproval.argsSummary,
        });
      }
    }
    return map;
  }, [tasks]);

  const plan = useMemo(
    () =>
      computeLaunchPlan({
        businessCreatedAt,
        now: Date.now(),
        contextFileKeys: new Set(contextFileKeys),
        hasSkill,
        hasTask: tasks.length > 0,
        hasCompletedTask: tasks.some((t) => t.status === "done"),
      }),
    [businessCreatedAt, contextFileKeys, hasSkill, tasks],
  );

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
          <EventTimeline events={events} pendingApprovals={pendingApprovals} />
        </div>
        <Composer onSent={refetch} />
      </div>
      <div className="flex w-72 shrink-0 flex-col">
        <div className="min-h-0 flex-1">
          <TaskBoard tasks={tasks} onChanged={refetch} />
        </div>
        <LaunchPlanWidget plan={plan} />
      </div>
    </div>
  );
}
