"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Every /dashboard route talks to a live Convex deployment with no cache to
// fall back to (see DECISIONS.md's THI-17 entry) — a scoped-query miss, a
// transient Convex outage, or an over-limit read (see agentEvents.
// listRecentByBusiness) would otherwise take the whole route down with
// Next's generic error screen instead of something a reader can dismiss or
// retry from.
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Dashboard route error:", error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <p className="text-sm font-medium text-ink">Something went wrong loading this page.</p>
      <p className="max-w-sm text-sm text-ink-muted">{error.message}</p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
