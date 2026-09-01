import "server-only";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { getDashboardConvexClient } from "./dashboardConvex";
import { getConvexServiceSecret } from "./serviceSecret";

export type AgentEventDoc = Doc<"agentEvents">;
export type AgentTaskDoc = Doc<"agentTasks">;

export type TimelineSnapshot = {
  events: AgentEventDoc[];
  tasks: AgentTaskDoc[];
};

// Backs both the initial server-rendered page and the client-side polling
// route (app/api/dashboard/timeline/route.ts) — there is no live Convex
// WS subscription available to the browser (every Convex function is
// service-secret gated, see convex/lib/serviceAuth.ts, and that secret must
// never reach client JS), so "live" on this dashboard means "polled" (every
// 4s, see components/workspace/workspace-screen.tsx). Events use the
// bounded listRecentByBusiness, not listByBusiness — a worker run logs
// several events per step, so an unbounded read here would both re-ship a
// business's entire history on every poll tick and eventually exceed
// Convex's per-query read limit outright as history grows.
export async function fetchTimeline(businessId: Id<"businesses">): Promise<TimelineSnapshot> {
  const client = getDashboardConvexClient();
  const secret = getConvexServiceSecret();
  const [events, tasks] = await Promise.all([
    client.action(api.agentEventsActions.listRecentByBusiness, { businessId, secret }),
    client.action(api.agentTasksActions.listByBusiness, { businessId, secret }),
  ]);
  return { events, tasks };
}

export async function sendChatMessage(
  businessId: Id<"businesses">,
  text: string,
): Promise<void> {
  const client = getDashboardConvexClient();
  await client.action(api.agentEventsActions.sendChatMessage, {
    businessId,
    authorRole: "owner",
    text,
    secret: getConvexServiceSecret(),
  });
}

// Confirmation queue + inline timeline card both call this one function —
// see components/approvals/approval-action-buttons.tsx, the shared
// implementation THI-17 asks for ("one component, two entry points").
export async function resolveToolApproval(
  businessId: Id<"businesses">,
  taskId: Id<"agentTasks">,
  decision: "approved" | "denied",
): Promise<AgentTaskDoc | null> {
  const client = getDashboardConvexClient();
  return client.action(api.agentTasksActions.resolveToolApproval, {
    businessId,
    taskId,
    actor: "owner",
    decision,
    secret: getConvexServiceSecret(),
  });
}

// The task board's only owner-initiated transition today: closing out a task
// that's finished worker execution and is sitting in needs_review. Every
// other edge (todo->in_progress, in_progress->needs_review) is driven by the
// worker-execution loop itself (convex/agentTasks.ts's beginWorkerRun /
// completeWorkerRun), not by anything this dashboard calls.
export async function markTaskDone(
  businessId: Id<"businesses">,
  taskId: Id<"agentTasks">,
): Promise<AgentTaskDoc | null> {
  const client = getDashboardConvexClient();
  return client.action(api.agentTasksActions.advanceStatus, {
    businessId,
    taskId,
    toStatus: "done",
    actor: "owner",
    secret: getConvexServiceSecret(),
  });
}
