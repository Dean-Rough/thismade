import { ConfirmationsQueue } from "@/components/confirmations/confirmations-queue";
import { resolveDashboardBusinessId } from "@/lib/api/dashboardBusiness";
import { fetchTimeline } from "@/lib/api/dashboardTimeline";

export const dynamic = "force-dynamic";

// THI-14 Part 4.3: list of pending items, expandable to the same card
// treatment as the inline approval_resolution timeline card. See
// components/approvals/pending-approval-content.tsx for the shared
// Confirm/Reject implementation both surfaces call.
export default async function ConfirmationsPage() {
  const businessId = await resolveDashboardBusinessId();
  const { tasks } = await fetchTimeline(businessId);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-lg font-medium">Confirmations</h1>
      <div className="rounded-card border border-border bg-surface-raised">
        <ConfirmationsQueue tasks={tasks} />
      </div>
    </div>
  );
}
