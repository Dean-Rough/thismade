import { cookies } from "next/headers";

import { DASHBOARD_ACCESS_COOKIE, readDashboardSecret, timingSafeEqualString } from "@/lib/dashboardAuth";

// THI-90 follow-up (reviewer-deep finding, PR #19): middleware.ts's matcher
// only covers requests to a matched *route*. A Server Action's reachable
// paths are derived from every route that imports its module (Next's
// server-reference-manifest), not just the route it's defined under — proven
// live in review: co-importing a dashboard action from a component that also
// renders on a public route (e.g. a shared nav/top-bar component) makes that
// action callable from the public route's own POST, bypassing this
// middleware's matcher entirely with no build/lint/test failure.
//
// Every Server Action in app/dashboard/actions.ts (landing via THI-17) MUST
// call this as its first line. The middleware gate is necessary but not
// sufficient — this is the actual boundary for mutation-capable code.
//
// Kept in its own module (not lib/dashboardAuth.ts) so middleware.ts's Edge
// bundle never pulls in `next/headers`, which is a Server
// Component/Action/Route-Handler API and unsupported in middleware.
export async function assertDashboardAccess(): Promise<void> {
  const secret = readDashboardSecret();
  if (!secret) {
    throw new Error("dashboard_access_not_configured");
  }
  const value = (await cookies()).get(DASHBOARD_ACCESS_COOKIE)?.value;
  if (!value || !timingSafeEqualString(value, secret)) {
    throw new Error("unauthorized");
  }
}
