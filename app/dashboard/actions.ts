"use server";

import { revalidatePath } from "next/cache";
import type { Id } from "@/convex/_generated/dataModel";
import { resolveDashboardBusinessId } from "@/lib/api/dashboardBusiness";
import { markTaskDone, resolveToolApproval, sendChatMessage } from "@/lib/api/dashboardTimeline";
import { assertDashboardAccess } from "@/lib/assertDashboardAccess";

// Every action here resolves its own businessId server-side and revalidates
// every dashboard route that reads timeline/task data — cheap given this is
// a single-business dashboard, and simpler than threading which specific
// path called in from (composer vs. confirmations queue vs. inline card).
function revalidateDashboard() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/confirmations");
}

export async function sendChatMessageAction(text: string): Promise<void> {
  await assertDashboardAccess();
  const trimmed = text.trim();
  if (!trimmed) {
    return;
  }
  const businessId = await resolveDashboardBusinessId();
  await sendChatMessage(businessId, trimmed);
  revalidateDashboard();
}

// Shared by the inline tool_call_pending_approval timeline card and the
// /dashboard/confirmations queue (THI-17 acceptance criteria: "one
// component, two entry points, do not fork the logic") — both call this
// same action, which itself calls the one underlying Convex mutation
// (agentTasks.resolveToolApproval).
//
// THI-91: argsHash is the caller's proof that it's resolving the exact
// pending call it displayed, not just whatever the task's current
// pendingApproval happens to be — see agentTasks.resolveToolApproval's own
// comment. Both call sites read it off their own data (the timeline event's
// argsHash, or the task's live pendingApproval.argsHash), never off a value
// this action invents.
export async function resolveApprovalAction(
  taskId: Id<"agentTasks">,
  decision: "approved" | "denied",
  argsHash: string,
): Promise<void> {
  await assertDashboardAccess();
  const businessId = await resolveDashboardBusinessId();
  const result = await resolveToolApproval(businessId, taskId, decision, argsHash);
  // resolveToolApproval resolves null on a missing task or (per
  // convex/agentTasks.ts) an already-resolved approval — the caller must
  // throw rather than let the button report "Approved"/"Rejected" for a
  // decision that was never actually recorded. A stale/mismatched argsHash
  // throws approval_argshash_mismatch instead of resolving null, which
  // surfaces the same way to the button below.
  if (!result) {
    throw new Error("approval_target_not_found_or_already_resolved");
  }
  revalidateDashboard();
}

export async function markTaskDoneAction(taskId: Id<"agentTasks">): Promise<void> {
  await assertDashboardAccess();
  const businessId = await resolveDashboardBusinessId();
  const result = await markTaskDone(businessId, taskId);
  if (!result) {
    throw new Error("task_not_found_or_invalid_transition");
  }
  revalidateDashboard();
}
