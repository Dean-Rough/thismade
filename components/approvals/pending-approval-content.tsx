import type { Id } from "@/convex/_generated/dataModel";
import { ApprovalActionButtons } from "./approval-action-buttons";

// The one card body for a pending destructive-tool-call approval — reused by
// the inline timeline card (components/timeline/cards/
// tool-call-pending-approval-card.tsx) and the /dashboard/confirmations
// queue (components/confirmations/confirmations-queue.tsx). THI-17
// acceptance criteria: same card treatment, one component, two entry points.
export function PendingApprovalContent({
  taskId,
  toolName,
  argsSummary,
  argsHash,
  isStillPending,
}: {
  taskId: Id<"agentTasks">;
  toolName: string;
  argsSummary: string;
  // THI-91: threaded straight to ApprovalActionButtons — see that
  // component's own comment for why this binds the decision to the exact
  // pending call being shown.
  argsHash: string;
  isStillPending: boolean;
}) {
  return (
    <>
      <p className="font-mono text-xs">{toolName}</p>
      <p className="mt-1 text-ink-muted">{argsSummary}</p>
      {isStillPending ? (
        <div className="mt-2">
          <ApprovalActionButtons taskId={taskId} argsHash={argsHash} />
        </div>
      ) : (
        <p className="mt-2 text-xs text-ink-muted">Resolved — see the decision below.</p>
      )}
    </>
  );
}
