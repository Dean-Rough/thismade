import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
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

const ACTOR = v.union(
  v.literal("owner"),
  v.literal("ceo"),
  v.literal("worker"),
  v.literal("system"),
);

// Blast-radius caps on the free-text fields a worker's prompt is eventually
// built from (THI-62: OWASP LLM01/LLM08 hardening). These don't make prompt
// injection impossible — no length limit can — but they bound how much
// attacker-influenced content a single dispatch can smuggle to a worker with
// tool access, and reject the degenerate empty/absent-instructions case.
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_INSTRUCTIONS_LENGTH = 8_000;

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
// Internal-only (THI-56): every function here is fronted by the matching
// action in agentTasksActions.ts, same pattern as THI-42.
//
// Trust-boundary hardening (THI-62): `instructions` is what a worker later
// executes against with real tool access, so this is the highest-blast-
// radius input in the whole system (OWASP LLM01 prompt injection / LLM08
// excessive agency). `containsUntrustedContent` has no default — the
// dispatcher must explicitly say whether these instructions embed
// lower-trust input (a chat message, catalog copy, a webhook payload) or
// are its own words, so provenance is a conscious decision at the one
// place it can still be made, not an assumption baked in later. Length caps
// bound how much of that content a single dispatch can carry regardless.
export const dispatch = internalMutation({
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
  },
  handler: async (ctx, args) => {
    if (args.maxAttempts !== undefined && args.maxAttempts < 1) {
      throw new Error("invalid_max_attempts");
    }
    if (args.title.length === 0 || args.title.length > MAX_TITLE_LENGTH) {
      throw new Error("invalid_title_length");
    }
    if (args.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new Error("invalid_description_length");
    }
    if (args.instructions.length === 0 || args.instructions.length > MAX_INSTRUCTIONS_LENGTH) {
      throw new Error("invalid_instructions_length");
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
      containsUntrustedContent: args.containsUntrustedContent,
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
        containsUntrustedContent: args.containsUntrustedContent,
      },
      createdAt: now,
    });

    return ctx.db.get(taskId);
  },
});

// Tenancy contract: a different business asking for the same id gets null,
// indistinguishable from a nonexistent id — mirrors orders.getScopedById.
export const getScopedById = internalQuery({
  args: { taskId: v.id("agentTasks"), businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"agentTasks"> | null> => {
    return getScoped<Doc<"agentTasks">>(ctx.db, args.taskId, args.businessId);
  },
});

export const listByBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("agentTasks")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

export const listByStatus = internalQuery({
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
//
// Human-in-the-loop gate (THI-62): `needs_review -> done` is the one
// transition that closes a task out for good, so it's the natural point to
// enforce the review step the lifecycle's name already promises. `actor`
// must now be supplied by every caller (fixing a real gap: this mutation
// used to hardcode the logged actor to "system" regardless of who — worker,
// CEO, or owner — actually asked for the transition), and only "owner" or
// "ceo" may make that specific transition — a worker (or anything acting on
// its behalf, including a worker redirected by injected instructions)
// cannot unilaterally mark its own task done.
//
// Identity boundary (THI-68): a caller-supplied `actor` literal, on its own,
// only proves the caller is *honest* about who it is — it proves nothing.
// This mutation stays as the general-purpose entry point (used today by
// direct/test callers and, eventually, a real authenticated owner/CEO
// approval surface once one exists), but the sandboxed worker-execution loop
// this ticket adds must never be able to reach it with `actor: "owner"` or
// `"ceo"` merely because it decided to say so. `beginWorkerRun` and
// `completeWorkerRun` below are the loop's only two entry points, and
// neither accepts `actor` as a parameter at all — the actor is fixed by
// which function the caller's role lets it call, not by what it claims.
async function transitionTask(
  ctx: MutationCtx,
  args: {
    businessId: Doc<"agentTasks">["businessId"];
    taskId: Doc<"agentTasks">["_id"];
    toStatus: "todo" | "in_progress" | "needs_review" | "done";
    actor: "owner" | "ceo" | "worker" | "system";
  },
): Promise<Doc<"agentTasks"> | null> {
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
  if (
    task.status === "needs_review" &&
    args.toStatus === "done" &&
    args.actor !== "owner" &&
    args.actor !== "ceo"
  ) {
    throw new Error("done_requires_owner_or_ceo_approval");
  }

  const now = Date.now();
  await ctx.db.patch(args.taskId, { status: args.toStatus, updatedAt: now });
  await logEvent(ctx, {
    businessId: args.businessId,
    taskId: args.taskId,
    actor: args.actor,
    event: {
      kind: "status_change",
      taskId: args.taskId,
      fromStatus: task.status,
      toStatus: args.toStatus,
    },
    createdAt: now,
  });
  return ctx.db.get(args.taskId);
}

export const advanceStatus = internalMutation({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
    toStatus: STATUS,
    actor: ACTOR,
  },
  handler: async (ctx, args) => transitionTask(ctx, args),
});

// The worker-execution loop's only way to claim a dispatched task and start
// running it. No `actor` param — always logged as "system" (the dispatcher's
// own trusted orchestration, not a worker or a human). Restricted to
// todo -> in_progress: a second concurrent claim attempt (e.g. a duplicate
// scheduler retry) hits `invalid_transition` here rather than double-running
// a worker, since Convex mutations are serializable — see convex/dispatcher.ts.
export const beginWorkerRun = internalMutation({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
  },
  handler: async (ctx, args) =>
    transitionTask(ctx, { ...args, toStatus: "in_progress", actor: "system" }),
});

// The worker-execution loop's only way to hand a finished run back for
// review. No `actor` param — always logged as "worker". Restricted to
// in_progress -> needs_review; the loop has no function that can reach
// needs_review -> done (that stays behind the owner/ceo-gated advanceStatus
// above), so injected instructions mid-run cannot talk the loop into
// approving its own work.
export const completeWorkerRun = internalMutation({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
  },
  handler: async (ctx, args) =>
    transitionTask(ctx, { ...args, toStatus: "needs_review", actor: "worker" }),
});

// Records a failed worker attempt (design lens: circuit-break runaway
// loops). Trips circuitBroken once attemptCount reaches maxAttempts so a
// worker that keeps failing the same way stops and surfaces instead of
// spinning through retries forever.
export const recordAttemptFailure = internalMutation({
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
    // THI-73 Finding 2: release any resume claim on failure too, so a
    // not-yet-circuit-broken task remains eligible for a future resume path
    // rather than being stuck claimed forever with nothing left to clear it.
    await ctx.db.patch(args.taskId, { attemptCount, circuitBroken, resumeClaimedAt: undefined, updatedAt: now });
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

// THI-66: the worker loop's (convex/lib/workerLoop.ts's
// isDestructiveToolCall gate) only way to record that it paused instead of
// executing a destructive tool call. No `actor` param — same
// identity-boundary reasoning as beginWorkerRun/completeWorkerRun, this is
// the loop's own infrastructure noting a pause, never a claim to be human.
// Deliberately doesn't touch `status`: the gate is orthogonal to the
// todo/in_progress/needs_review/done kanban lifecycle, not a fifth column —
// a task can sit here mid-run, well before it would otherwise reach
// needs_review.
export const requestToolApproval = internalMutation({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
    toolName: v.string(),
    argsSummary: v.string(),
    // THI-74 Finding 3: the full-fidelity binding — see
    // convex/lib/workerLoop.ts's hashToolArgs. argsSummary stays for what an
    // owner/CEO actually reads when deciding; argsHash is what the gate
    // compares against on resume.
    argsHash: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await getScoped<Doc<"agentTasks">>(ctx.db, args.taskId, args.businessId);
    if (!task) {
      return null;
    }
    if (task.circuitBroken) {
      throw new Error("task_circuit_broken");
    }
    if (task.status !== "in_progress") {
      throw new Error(`invalid_pending_approval_status:${task.status}`);
    }
    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      pendingApproval: {
        toolName: args.toolName,
        argsSummary: args.argsSummary,
        argsHash: args.argsHash,
        requestedAt: now,
      },
      // THI-73 Finding 2: a resumed run that hits a second destructive call
      // pauses here too (status stays "in_progress" the whole time), so the
      // prior resume's claim must be released now — otherwise a later
      // approval's resumeWorkerTask would find resumeClaimedAt still set
      // and be unable to claim its own resume.
      resumeClaimedAt: undefined,
      updatedAt: now,
    });
    return ctx.db.get(args.taskId);
  },
});

// THI-66: the only way to clear a pending destructive-call approval.
// `actor` is restricted to "owner" | "ceo" at the argument-validator level
// (narrower than the general ACTOR union) — the same human-in-the-loop
// boundary as the needs_review -> done transition above, enforced earlier
// here since there's no other business-logic branch that would otherwise
// need to check it. A worker (or anything acting on its behalf via injected
// instructions) has no path to this mutation at all.
//
// Idempotent by construction: this throws "no_pending_approval" once
// pendingApproval has been cleared, so a retried call (network retry,
// duplicate click) after the first one already resolved cannot re-decide or
// double-schedule a resume — the same check-then-mutate guard used
// elsewhere (dispatchKey, credit ledger, transitionTask's allowed-edges
// check).
export const resolveToolApproval = internalMutation({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
    actor: v.union(v.literal("owner"), v.literal("ceo")),
    decision: v.union(v.literal("approved"), v.literal("denied")),
  },
  handler: async (ctx, args) => {
    const task = await getScoped<Doc<"agentTasks">>(ctx.db, args.taskId, args.businessId);
    if (!task) {
      return null;
    }
    if (task.circuitBroken) {
      throw new Error("task_circuit_broken");
    }
    if (!task.pendingApproval) {
      throw new Error("no_pending_approval");
    }
    const { toolName, argsHash } = task.pendingApproval;
    const now = Date.now();
    await ctx.db.patch(args.taskId, { pendingApproval: undefined, updatedAt: now });
    await logEvent(ctx, {
      businessId: args.businessId,
      taskId: args.taskId,
      actor: args.actor,
      event: { kind: "tool_call_approval_decision", taskId: args.taskId, toolName, decision: args.decision },
      createdAt: now,
    });

    if (args.decision === "denied") {
      // The task can't proceed on its own past a denied destructive call —
      // hand it to needs_review so the owner/CEO decides what happens next
      // (abandon, re-dispatch with amended instructions, etc.), the same
      // in_progress -> needs_review edge completeWorkerRun uses for a
      // normal finish.
      return transitionTask(ctx, {
        businessId: args.businessId,
        taskId: args.taskId,
        toStatus: "needs_review",
        actor: args.actor,
      });
    }

    // Approved: schedule a resumed run (convex/workerRunner.ts's
    // resumeWorkerTask). No conversation or sandbox state survives the
    // pause — see that function's own comment for why a resumed run
    // replays `instructions` from scratch with a single-use grant rather
    // than continuing mid-conversation. THI-73 Finding 1 / THI-74 Finding 3:
    // the grant carries the approved argsHash alongside toolName, not just
    // the name (Finding 1) and not the truncated argsSummary (Finding 3) —
    // see workerLoop.ts's approvedCall/hashToolArgs for why.
    await ctx.scheduler.runAfter(0, internal.workerRunner.resumeWorkerTask, {
      businessId: args.businessId,
      taskId: args.taskId,
      approvedToolName: toolName,
      approvedArgsHash: argsHash,
    });
    return ctx.db.get(args.taskId);
  },
});

// THI-73 Finding 2: the atomic claim a resumed run needs, mirroring
// beginWorkerRun's throw-on-second-caller semantics for a fresh dispatch.
// Status transitions can't serve that role here — a resumed run doesn't
// change `status` (it stays "in_progress" for the whole pause/resume
// cycle) — so this compares-and-sets `resumeClaimedAt` instead: the first
// caller to see it unset wins and stamps it; Convex mutations are
// serializable per document, so a second concurrent call (scheduler
// redelivery, a future caller mistake) reads the already-stamped value and
// throws rather than also proceeding to run a second sandbox/loop against
// the same task. Cleared by requestToolApproval and recordAttemptFailure
// once this resumed run stops (paused again, or failed) so a later resume
// can claim again.
export const beginResumedWorkerRun = internalMutation({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
  },
  handler: async (ctx, args) => {
    const task = await getScoped<Doc<"agentTasks">>(ctx.db, args.taskId, args.businessId);
    if (!task) {
      return null;
    }
    if (task.circuitBroken) {
      throw new Error("task_circuit_broken");
    }
    if (task.status !== "in_progress" || task.pendingApproval) {
      throw new Error(`invalid_resume_claim_status:${task.status}`);
    }
    if (task.resumeClaimedAt !== undefined) {
      throw new Error("resume_already_claimed");
    }
    const now = Date.now();
    await ctx.db.patch(args.taskId, { resumeClaimedAt: now, updatedAt: now });
    return ctx.db.get(args.taskId);
  },
});
