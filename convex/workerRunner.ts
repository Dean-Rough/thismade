"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createSandboxProvider } from "./lib/sandboxProvider";
import type { SandboxHandle } from "./lib/sandboxProvider";
import { AiSdkLlmClient } from "./lib/llmClient";
import { runWorkerLoop } from "./lib/workerLoop";
import type { WorkerLoopEvent } from "./lib/workerLoop";
import { buildSystemPrompt } from "./lib/workerPrompts";
import type { WorkerType } from "./lib/workerTools";
import type { ActionCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

function toRichContentEvent(taskId: Id<"agentTasks">, event: WorkerLoopEvent) {
  switch (event.kind) {
    case "tool_call":
      return { kind: "tool_call" as const, taskId, toolName: event.toolName, argsSummary: event.argsSummary };
    case "tool_result":
      return {
        kind: "tool_result" as const,
        taskId,
        toolName: event.toolName,
        ok: event.ok,
        resultSummary: event.resultSummary,
      };
    case "file_diff":
      return { kind: "file_diff" as const, taskId, path: event.path, diffSummary: event.diffSummary };
    case "error":
      return { kind: "error" as const, taskId, message: event.message };
    case "tool_call_pending_approval":
      return {
        kind: "tool_call_pending_approval" as const,
        taskId,
        toolName: event.toolName,
        argsSummary: event.argsSummary,
      };
  }
}

// The shared execution body for both a fresh dispatch (runWorkerTask) and a
// post-approval resume (resumeWorkerTask) — everything from sandbox
// provisioning through outcome handling is identical between the two; only
// the idempotent-dispatch guard each is entered through, and the optional
// approvedToolName grant, differ. See runWorkerLoop's WorkerLoopOptions for
// what approvedToolName does.
async function performWorkerRun(
  ctx: ActionCtx,
  args: { businessId: Id<"businesses">; taskId: Id<"agentTasks"> },
  opts: { approvedToolName?: string },
): Promise<void> {
  const task = await ctx.runQuery(internal.agentTasks.getScopedById, args);
  if (!task) {
    return;
  }

  // The actual work instructions live on the `dispatch` agentEvents row,
  // not the agentTasks row itself (agentTasks.dispatch logs them onto the
  // event but never patches them onto the task — title/description on the
  // row are a human-readable summary, not the worker's brief).
  const events = await ctx.runQuery(internal.agentEvents.listByTask, args);
  const dispatchEvent = events.find((e) => e.event.kind === "dispatch");
  const instructions =
    dispatchEvent && dispatchEvent.event.kind === "dispatch" ? dispatchEvent.event.instructions : task.description;

  const workerType = task.workerType as WorkerType;
  let sandbox: SandboxHandle | null = null;

  try {
    // Least privilege by construction: marketing tasks never get a
    // sandbox provisioned at all, not just a runtime-denied shell tool —
    // see convex/lib/workerTools.ts.
    if (workerType !== "marketing") {
      const provider = createSandboxProvider();
      sandbox = await provider.create({ label: `${args.businessId}:${args.taskId}` });
    }

    const contextFiles = await ctx.runQuery(internal.agentContextFiles.listByBusiness, {
      businessId: args.businessId,
    });
    const systemPrompt = buildSystemPrompt(workerType, contextFiles);

    const onEvent = async (event: WorkerLoopEvent) => {
      await ctx.runMutation(internal.agentEvents.logWorkerEvent, {
        businessId: args.businessId,
        taskId: args.taskId,
        actor: "worker",
        event: toRichContentEvent(args.taskId, event),
      });
    };

    const outcome = await runWorkerLoop({
      workerType,
      systemPrompt,
      instructions,
      llmClient: new AiSdkLlmClient(),
      toolContext: {
        sandbox,
        readContextFile: async (fileKey: string) => {
          const file = contextFiles.find((f) => f.fileKey === fileKey);
          return file ? file.content : null;
        },
      },
      approvedToolName: opts.approvedToolName,
      onEvent,
    });

    if (outcome.status === "completed") {
      await ctx.runMutation(internal.agentTasks.completeWorkerRun, args);
    } else if (outcome.status === "awaiting_approval") {
      // THI-66: pause for a human decision instead of recording a failure —
      // this isn't the worker erroring, it's the gate in workerLoop.ts
      // working as designed. agentTasks.resolveToolApproval is the only
      // path back out of this state (approve schedules resumeWorkerTask;
      // deny moves the task to needs_review).
      await ctx.runMutation(internal.agentTasks.requestToolApproval, {
        businessId: args.businessId,
        taskId: args.taskId,
        toolName: outcome.pendingApproval!.toolName,
        argsSummary: outcome.pendingApproval!.argsSummary,
      });
    } else {
      await ctx.runMutation(internal.agentTasks.recordAttemptFailure, {
        businessId: args.businessId,
        taskId: args.taskId,
        errorMessage: outcome.failureReason ?? "worker_loop_circuit_broken",
      });
    }
  } catch (err) {
    // Anything that escapes the loop itself — sandbox provisioning
    // failure (e.g. E2B_API_KEY not configured), an LLM call failure
    // outside a tool execution, or any other uncaught error.
    // recordAttemptFailure already logs its own typed `error` event
    // (actor "worker", see agentTasks.ts) — a second logWorkerEvent call
    // here would just duplicate the same failure on the task's timeline
    // under a different actor. Caught live in the THI-68 smoke run below.
    const message = err instanceof Error ? err.message : String(err);
    await ctx.runMutation(internal.agentTasks.recordAttemptFailure, {
      businessId: args.businessId,
      taskId: args.taskId,
      errorMessage: message,
    });
  } finally {
    if (sandbox) {
      await sandbox.close();
    }
  }
}

// The "use node" boundary: this is the only file in convex/ that imports the
// e2b/ai SDKs or does real network I/O for the worker loop — everything it
// delegates to (workerLoop.ts, workerTools.ts, llmClient.ts, sandboxProvider
// .ts) is plain TS, unit-testable without a live sandbox or model. This
// action is scheduled by convex/dispatcher.ts's runTask, never called
// directly by anything outside this Convex deployment.
export const runWorkerTask = internalAction({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
  },
  handler: async (ctx, args) => {
    // Idempotent-dispatch guard (see convex/dispatcher.ts): if this task has
    // already left `todo` — already running under an earlier schedule,
    // already finished, or circuit-broken — this throws and we no-op rather
    // than starting a second concurrent run of the same task.
    try {
      await ctx.runMutation(internal.agentTasks.beginWorkerRun, args);
    } catch {
      return;
    }
    await performWorkerRun(ctx, args, {});
  },
});

// THI-66: the only way an approved destructive tool call gets to actually
// run — scheduled exclusively by agentTasks.resolveToolApproval's "approved"
// branch. No sandbox or conversation state survives the pause that led here
// (each sandbox is fully torn down — SandboxHandle has no pause/resume, see
// lib/sandboxProvider.ts — and runWorkerLoop's `messages` array lives only
// in that one action invocation's memory), so this replays `instructions`
// from scratch through a brand new sandbox, carrying forward only a
// single-use grant for `approvedToolName`. The model retraces its own
// reasoning up to the same destructive call, which this time executes
// instead of pausing again — simple and correct rather than a stateful
// resume, the same tradeoff workerTools.ts's browser driver makes for the
// same reason (see its own comment).
export const resumeWorkerTask = internalAction({
  args: {
    businessId: v.id("businesses"),
    taskId: v.id("agentTasks"),
    approvedToolName: v.string(),
  },
  handler: async (ctx, { approvedToolName, ...args }) => {
    // Idempotent-dispatch guard, mirroring runWorkerTask's beginWorkerRun
    // check: resolveToolApproval already clears pendingApproval in the same
    // mutation that schedules this action, so a genuine duplicate schedule
    // finds it already gone (or the task already moved on) and no-ops
    // rather than running the worker loop a second time.
    const task = await ctx.runQuery(internal.agentTasks.getScopedById, args);
    if (!task || task.status !== "in_progress" || task.pendingApproval) {
      return;
    }
    await performWorkerRun(ctx, args, { approvedToolName });
  },
});
