import "server-only";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { getDashboardConvexClient } from "./dashboardConvex";
import { getConvexServiceSecret } from "./serviceSecret";

// The dashboard has no login/session layer at all yet — see DECISIONS.md's
// Phase 3 frontend (THI-17) entry, which extends THI-15's "single implicit
// business context" assumption (nav rail hardcodes "Your business", no
// switcher) with a real id instead of nothing. DASHBOARD_BUSINESS_ID names
// the one business this deployment renders; there is no UI for switching it,
// and none of this app's real tenancy (convex/lib/tenancy.ts) is bypassed —
// every Convex call below still goes through the normal service-secret-gated
// actions and is scoped by this businessId like any other caller.
export async function resolveDashboardBusiness(): Promise<Doc<"businesses">> {
  const raw = process.env.DASHBOARD_BUSINESS_ID;
  if (!raw) {
    throw new Error(
      "DASHBOARD_BUSINESS_ID is not configured — set it to the Convex id of the business this dashboard should render.",
    );
  }
  const businessId = raw as Id<"businesses">;

  const client = getDashboardConvexClient();
  const business = await client.action(api.businessesActions.getSelf, {
    businessId,
    secret: getConvexServiceSecret(),
  });
  if (!business) {
    throw new Error(`DASHBOARD_BUSINESS_ID ("${raw}") does not resolve to an existing business.`);
  }
  return business;
}

export async function resolveDashboardBusinessId(): Promise<Id<"businesses">> {
  const business = await resolveDashboardBusiness();
  return business._id;
}
