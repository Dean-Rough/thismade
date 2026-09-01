"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import type { Id } from "@/convex/_generated/dataModel";
import { resolveApprovalAction } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";

// The one Confirm/Reject implementation for a pending destructive-tool-call
// approval (convex/agentTasks.ts's requestToolApproval/resolveToolApproval,
// THI-66) — used inline on the timeline's tool_call_pending_approval card
// and on the /dashboard/confirmations queue, per THI-17's acceptance
// criteria. Both call the exact same resolveApprovalAction server action.
export function ApprovalActionButtons({ taskId }: { taskId: Id<"agentTasks"> }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [decided, setDecided] = useState<"approved" | "denied" | null>(null);

  function decide(decision: "approved" | "denied") {
    setError(null);
    startTransition(async () => {
      try {
        await resolveApprovalAction(taskId, decision);
        setDecided(decision);
      } catch {
        setError("Could not record that decision — try again.");
      }
    });
  }

  if (decided) {
    return (
      <p className="text-xs text-ink-muted">
        {decided === "approved" ? "Approved." : "Rejected."}
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Button size="sm" disabled={isPending} onClick={() => decide("approved")}>
          <Check /> Confirm
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={isPending}
          onClick={() => decide("denied")}
        >
          <X /> Reject
        </Button>
      </div>
      {error && <p className="text-xs text-confirmation-rejected">{error}</p>}
    </div>
  );
}
