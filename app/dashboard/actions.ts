"use server";

import { revalidatePath } from "next/cache";
import type { Id } from "@/convex/_generated/dataModel";
import { resolveDashboardBusinessId } from "@/lib/api/dashboardBusiness";
import { markTaskDone, resolveToolApproval, sendChatMessage } from "@/lib/api/dashboardTimeline";

// Every action here resolves its own businessId server-side and revalidates
// every dashboard route that reads timeline/task data — cheap given this is
// a single-business dashboard, and simpler than threading which specific
// path called in from (composer vs. confirmations queue vs. inline card).
function revalidateDashboard() {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/confirmations");
}

export async function sendChatMessageAction(text: string): Promise<void> {
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
export async function resolveApprovalAction(
  taskId: Id<"agentTasks">,
  decision: "approved" | "denied",
): Promise<void> {
  const businessId = await resolveDashboardBusinessId();
  await resolveToolApproval(businessId, taskId, decision);
  revalidateDashboard();
}

export async function markTaskDoneAction(taskId: Id<"agentTasks">): Promise<void> {
  const businessId = await resolveDashboardBusinessId();
  await markTaskDone(businessId, taskId);
  revalidateDashboard();
}
