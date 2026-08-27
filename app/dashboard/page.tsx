import { MessageSquare } from "lucide-react";

/**
 * The workspace/timeline flagship screen (THI-14 Part 4.2) lands in Phase 3
 * once `richContent` events exist on the Convex wire — this Phase 1 shell
 * only needs a placeholder so the route renders.
 */
export default function DashboardPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <MessageSquare className="size-8 text-ink-muted" />
      <p className="text-sm text-ink-muted">
        The workspace timeline arrives in Phase 3, once agent events are wired up.
      </p>
    </div>
  );
}
