import { NextResponse } from "next/server";
import { resolveDashboardBusinessId } from "@/lib/api/dashboardBusiness";
import { fetchTimeline } from "@/lib/api/dashboardTimeline";

// Polling backend for the workspace timeline's "live" updates
// (components/workspace/workspace-screen.tsx). Deliberately takes no
// businessId parameter from the request — it always resolves the one
// dashboard-implicit business server-side, so this can never become an
// arbitrary-businessId read surface. Not under /v1 (that's the external,
// Bearer-API-key-authenticated developer API — a different trust boundary);
// this route has no auth of its own because the dashboard itself has none
// yet, a pre-existing gap tracked in DECISIONS.md, not introduced here.
export const dynamic = "force-dynamic";

export async function GET() {
  const businessId = await resolveDashboardBusinessId();
  const timeline = await fetchTimeline(businessId);
  return NextResponse.json(timeline);
}
