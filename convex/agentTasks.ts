import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getScoped } from "./lib/tenancy";
import { logEvent } from "./lib/events";
import { spendCredits } from "./creditLedger";
import type { Doc } from "./_generated/dataModel";

const WORKER_TYPE = v.union(
  v.literal("coding"),
  v.literal("browser"),
  v.literal("marketing"),
);

const STATUS = v.union(
  v.literal("todo"),
  v.literal("in_progress"),
  v.literal("needs_review"),
  v.literal("done"),
);

// Forward-only kanban lifecycle: todo -> in_progress -> needs_review -> done.
// No other edge is legal — a worker or the CEO that wants to send work back
// for another pass does so by dispatching a new task, not by rewinding this
// one, so the board never has to represent "in progress, again."
const ALLOWED_TRANSITIONS: Record<string, ReadonlyArray<string>> = {
  todo: ["in_progress"],
  in_progress: ["needs_review"],
  needs_review: ["done"],
  done: [],
};

// The CEO orchestrator's single entry point for handing work to a worker.
// Keyed by a caller-supplied dispatchKey (design lens: idempotent dispatch)
// so a dispatcher retry after a crash or reconnect replays the same call and
// gets back the same task instead of spawning a duplicate worker run — the
// same check-then-insert idiom as orders.createFromCheckoutSession.
//
// Credit-gated: per docs/madethis-rebuild-plan.md ("each task has a role, a
// credit cost, and an execution trace"), dispatch spends creditCost from the
// business's balance in this same mutation, before the task row is created —
// an insufficient balance throws "insufficient_credit" and no task is
// created at all. The spend's idempotencyKey is dispatchKey namespaced under
// "dispatch:" (not the bare dispatchKey) so it can never collide with a key
// someone chose for a direct creditLedger.spend call — spendCredits itself
// still rejects any (businessId, idempotencyKey) reuse whose amount doesn't
// match ("credit_spend_conflict"), so even a guessed/colliding key can't
// buy a bigger debit than it paid for.
export const dispatch = mutation({
  args: {
    businessId: v.id("businesses"),
    title: v.string(),
    description: v.string(),
    workerType: WORKER_TYPE,
    dispatchKey: v.string(),
    instructions: v.string(),
    creditCost: v.number(),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (args.maxAttempts !== undefined && args.maxAttempts < 1) {
      throw new Error("invalid_max_attempts");
    }

    // Scoped by businessId, not a global lookup — a caller-supplied
    // dispatchKey is predictable ("plan-turn-1:task-1"), so a global index
    // would let one business's dispatchKey collide with another's and read
    // back that other business's task.
    const existing = await ctx.db
      .query("agentTasks")
      .withIndex("by_business_dispatch_key", (q) =>
        q.eq("businessId", args.businessId).eq("dispatchKey", args.dispatchKey),
      )
      .unique();
    if (existing) {
      return existing;
    }

    const spendResult = await spendCredits(ctx, {
      businessId: args.businessId,
      amount: args.creditCost,
      reason: `dispatch: ${args.title}`,
      idempotencyKey: `dispatch:${args.dispatchKey}`,
    });

    const now = Date.now();
    const taskId = await ctx.db.insert("agentTasks", {
      businessId: args.businessId,
      title: args.title,
      description: args.description,
      workerType: args.workerType,
      status: "todo",
      dispatchKey: args.dispatchKey,
      creditCost: args.creditCost,
      attemptCount: 0,
      maxAttempts: args.maxAttempts ?? 3,
      circuitBroken: false,
      createdAt: now,
      updatedAt: now,
    });

    // Back-fill taskId onto the credit debit's transaction row and event —
    // the task doesn't exist yet when spendCredits runs, so it can't set
    // this itself. Same mutation/transaction as the insert above, so this
    // is still one atomic unit.
    if (spendResult.transactionId) {
      await ctx.db.patch(spendResult.transactionId, { taskId });
    }
    if (spendResult.eventId) {
      await ctx.db.patch(spendResult.eventId, { taskId });
    }

    await logEvent(ctx, {
      businessId: args.businessId,
      taskId,
      actor: "ceo",
      event: {
        kind: "dispatch",
        taskId,
        workerType: args.workerType,
        instructions: args.instructions,
      },
      createdAt: now,
    });

    return ctx.db.get(taskId);
  },
});

// Tenancy contract: a different business asking for the same id gets null,
// indistinguishable from a nonexistent id — mirrors orders.getScopedById.
export const getScopedById = query({
  args: { taskId: v.id("agentTasks"), businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"agentTasks"> | null> => {
    return getScoped<Doc<"agentTasks">>(ctx.db, args.taskId, args.businessId);
  },
});

export const listByBusiness = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agentTasks")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

export const listByStatus = query({
  args: { businessId: v.id("businesses"), status: STATUS },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agentTasks")
      .withIndex("by_business_status", (q) =>
        q.eq("businessId", args.businessId).eq("status", args.status),
      )
      .collect();
  },
});

// Advances a task's kanban column. Rejects any transition not in
// ALLOWED_TRANSITIONS and any transition at all on a circuit-broken task — a
// task that has tripped its retry cap must surface for attention, not keep
// moving through the board as if nothing happened.
export const advanceStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
    toStatus: STATUS,
  },
  handler: async (ctx, args) => {
    const task = await getScoped<Doc<"agentTasks">>(ctx.db, args.taskId, args.businessId);
    if (!task) {
      return null;
    }
    if (task.circuitBroken) {
      throw new Error("task_circuit_broken");
    }
    const allowed = ALLOWED_TRANSITIONS[task.status] ?? [];
    if (!allowed.includes(args.toStatus)) {
      throw new Error(`invalid_transition:${task.status}->${args.toStatus}`);
    }

    const now = Date.now();
    await ctx.db.patch(args.taskId, { status: args.toStatus, updatedAt: now });
    await logEvent(ctx, {
      businessId: args.businessId,
      taskId: args.taskId,
      actor: "system",
      event: {
        kind: "status_change",
        taskId: args.taskId,
        fromStatus: task.status,
        toStatus: args.toStatus,
      },
      createdAt: now,
    });
    return ctx.db.get(args.taskId);
  },
});

// Records a failed worker attempt (design lens: circuit-break runaway
// loops). Trips circuitBroken once attemptCount reaches maxAttempts so a
// worker that keeps failing the same way stops and surfaces instead of
// spinning through retries forever.
export const recordAttemptFailure = mutation({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
    errorMessage: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await getScoped<Doc<"agentTasks">>(ctx.db, args.taskId, args.businessId);
    if (!task) {
      return null;
    }
    if (task.circuitBroken) {
      throw new Error("task_circuit_broken");
    }
    const attemptCount = task.attemptCount + 1;
    const circuitBroken = attemptCount >= task.maxAttempts;
    const now = Date.now();
    await ctx.db.patch(args.taskId, { attemptCount, circuitBroken, updatedAt: now });
    await logEvent(ctx, {
      businessId: args.businessId,
      taskId: args.taskId,
      actor: "worker",
      event: { kind: "error", taskId: args.taskId, message: args.errorMessage },
      createdAt: now,
    });
    return ctx.db.get(args.taskId);
  },
});
