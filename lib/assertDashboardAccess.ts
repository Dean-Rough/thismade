import { headers } from "next/headers";

import { verifyBasicAuthHeader } from "@/lib/dashboard-auth";

// THI-90 follow-up (reviewer-deep finding): middleware.ts's matcher only
// covers requests to a matched *route*. A Server Action's reachable paths
// are derived from every route that imports its module (Next's
// server-reference-manifest), not just the route it's defined under —
// proven live in review: co-importing a dashboard action from a component
// that also renders on a public route makes that action callable from the
// public route's own POST, bypassing middleware.ts entirely with no
// build/lint/test failure.
//
// Every Server Action in app/dashboard/actions.ts must call this as its
// first line. The middleware gate is necessary but not sufficient on its
// own — this is the actual boundary for mutation-capable code. Re-checks
// the same HTTP Basic credentials middleware.ts does: the browser already
// caches and resends the Authorization header for same-origin requests
// (including Server Action POSTs) once the user has authenticated once, so
// this adds no extra prompt for a legitimate caller.
export async function assertDashboardAccess(): Promise<void> {
  const user = process.env.DASHBOARD_BASIC_AUTH_USER;
  const password = process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
  if (!user || !password) {
    throw new Error("dashboard_access_not_configured");
  }
  const authHeader = (await headers()).get("authorization");
  if (!verifyBasicAuthHeader(authHeader, user, password)) {
    throw new Error("unauthorized");
  }
}
