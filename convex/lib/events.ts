import type { GenericMutationCtx } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { richContentEvent } from "./richContent";
import type { Infer } from "convex/values";

type RichContentEvent = Infer<typeof richContentEvent>;

// Shared insert path so every mutation that appends to the timeline writes
// the same shape — callers pass the already-typed event union variant
// rather than hand-assembling the row.
export async function logEvent(
  ctx: GenericMutationCtx<any>,
  args: {
    businessId: Id<"businesses">;
    taskId?: Id<"agentTasks">;
    actor: "owner" | "ceo" | "worker" | "system";
    event: RichContentEvent;
    createdAt: number;
  },
): Promise<void> {
  await ctx.db.insert("agentEvents", {
    businessId: args.businessId,
    taskId: args.taskId,
    actor: args.actor,
    event: args.event,
    createdAt: args.createdAt,
  });
}
