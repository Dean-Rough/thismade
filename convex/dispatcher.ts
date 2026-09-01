import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc } from "./_generated/dataModel";

const WORKER_TYPE = v.union(
  v.literal("coding"),
  v.literal("browser"),
  v.literal("marketing"),
);

// THI-68: the CEO orchestrator's live entry point — creates the dispatched
// task (reusing agentTasks.dispatch's already-hardened, already-tested
// idempotency/credit-gate/trust-boundary logic verbatim) and then actually
// starts a sandboxed worker run for it, instead of leaving the row sitting
// in `todo` for nothing to ever pick up.
//
// Idempotent dispatch (design lens), for free: a retried call (crash,
// reconnect) replays `dispatch`'s existing dispatchKey dedup and gets the
// same task row back; scheduling the run is *always* attempted regardless,
// but convex/workerRunner.ts's first step (agentTasks.beginWorkerRun) is a
// todo -> in_progress transition that no-ops (throws, caught, logged, not
// retried) if the task has already left `todo` — so two schedules for the
// same task can never produce two live runs. See the THI-68 plan document
// for why this stays a separate action rather than scheduling from inside
// `dispatch` itself: convex-test does not auto-execute scheduled functions
// (`finishAllScheduledFunctions` is opt-in), so either approach is
// test-safe, but this keeps `dispatch` — and its 20+ existing passing tests
// — completely untouched.
export const runTask = action({
  args: {
    businessId: v.id("businesses"),
    title: v.string(),
    description: v.string(),
    workerType: WORKER_TYPE,
    dispatchKey: v.string(),
    instructions: v.string(),
    containsUntrustedContent: v.boolean(),
    creditCost: v.number(),
    maxAttempts: v.optional(v.number()),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Doc<"agentTasks"> | null> => {
    assertServiceSecret(secret);
    const task = await ctx.runMutation(internal.agentTasks.dispatch, args);
    if (!task) {
      return null;
    }
    await ctx.scheduler.runAfter(0, internal.workerRunner.runWorkerTask, {
      businessId: args.businessId,
      taskId: task._id,
    });
    return task;
  },
});
