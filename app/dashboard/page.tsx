import { WorkspaceScreen } from "@/components/workspace/workspace-screen";
import { resolveDashboardBusiness } from "@/lib/api/dashboardBusiness";
import { fetchLaunchPlanSignals } from "@/lib/api/dashboardFiles";
import { fetchTimeline } from "@/lib/api/dashboardTimeline";

// Always renders per-request against live Convex data — must never be
// statically prerendered (there's nothing to prerender against at build
// time; same class of fix as the Phase 1 Clerk-era `force-dynamic`, see
// DECISIONS.md).
export const dynamic = "force-dynamic";

// The workspace/timeline flagship screen (THI-14 Part 4.2, THI-17). Server
// Component: resolves the single implicit business and its initial data,
// then hands off to the client-side WorkspaceScreen for polling-driven
// "live" updates — see DECISIONS.md's THI-17 entry for why this isn't a
// direct convex/react subscription (every Convex function is service-secret
// gated; that secret must never reach the browser).
export default async function DashboardPage() {
  const business = await resolveDashboardBusiness();
  const [{ events, tasks }, { contextFileKeys, hasSkill }] = await Promise.all([
    fetchTimeline(business._id),
    fetchLaunchPlanSignals(business._id),
  ]);

  return (
    <WorkspaceScreen
      businessId={business._id}
      initialEvents={events}
      initialTasks={tasks}
      businessCreatedAt={business.createdAt}
      contextFileKeys={contextFileKeys}
      hasSkill={hasSkill}
    />
  );
}
