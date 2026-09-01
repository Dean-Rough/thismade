import "server-only";
import { ConvexHttpClient } from "convex/browser";

// Shared by every dashboard-side (internal, session-less) data access
// module — see lib/api/dashboardBusiness.ts for why the dashboard has its
// own Convex entry points instead of reusing lib/api/auth.ts's (that one is
// keyed off a caller's Bearer API key, which the dashboard has none of).
export function getDashboardConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}
