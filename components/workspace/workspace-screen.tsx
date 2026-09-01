"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Id } from "@/convex/_generated/dataModel";
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

  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/dashboard/timeline");
        if (!res.ok || cancelled) return;
        const data: { events: AgentEventDoc[]; tasks: AgentTaskDoc[] } = await res.json();
        setEvents(data.events);
        setTasks(data.tasks);
      } catch {
        // Transient network hiccup — next poll tick retries; the dashboard
        // has no other liveness signal to fall back to.
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [businessId]);

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

  const pendingTaskIds = useMemo(
    () => new Set(tasks.filter((t) => t.pendingApproval).map((t) => t._id)),
    [tasks],
  );

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
          <EventTimeline events={events} pendingTaskIds={pendingTaskIds} />
        </div>
        <Composer />
      </div>
      <div className="flex w-72 shrink-0 flex-col">
        <div className="min-h-0 flex-1">
          <TaskBoard tasks={tasks} />
        </div>
        <LaunchPlanWidget plan={plan} />
      </div>
    </div>
  );
}
