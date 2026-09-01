import { createHash } from "node:crypto";
import type { LlmClient, LlmMessage } from "./llmClient";
import {
  assertToolAllowed,
  executeTool,
  isDestructiveToolCall,
  ToolNotAllowedError,
  toolsForWorkerType,
} from "./workerTools";
import type { ToolExecutionContext, WorkerType } from "./workerTools";

// The pure orchestration core of THI-68's worker-execution loop. No Convex
// import, no E2B import, no `ai` import — everything I/O-shaped comes in as
// an injected LlmClient/ToolExecutionContext, so this file (and
// workerLoop.test.ts) can exercise the actual turn-by-turn logic — event
// sequencing, the tool-allowlist chokepoint, circuit breaking — with fakes,
// with no live E2B/LLM credentials required. convex/workerRunner.ts is the
// thin "use node" action that wires in the real implementations.

export type WorkerLoopEvent =
  | { kind: "tool_call"; toolName: string; argsSummary: string }
  | { kind: "tool_result"; toolName: string; ok: boolean; resultSummary: string }
  | { kind: "file_diff"; path: string; diffSummary: string }
  | { kind: "error"; message: string }
  | { kind: "tool_call_pending_approval"; toolName: string; argsSummary: string; argsHash: string };

export interface PendingToolApproval {
  toolName: string;
  argsSummary: string;
  // THI-74 Finding 3: full-fidelity binding for the approval grant — see
  // hashToolArgs below for why argsSummary alone (truncated at
  // ARGS_SUMMARY_MAX_LENGTH) isn't enough to gate on.
  argsHash: string;
}

export interface WorkerLoopOutcome {
  status: "completed" | "circuit_broken" | "awaiting_approval";
  turns: number;
  failureReason?: string;
  // Set only when status is "awaiting_approval" — see workerRunner.ts's
  // requestToolApproval wiring.
  pendingApproval?: PendingToolApproval;
}

export interface WorkerLoopOptions {
  workerType: WorkerType;
  systemPrompt: string;
  instructions: string;
  llmClient: LlmClient;
  toolContext: ToolExecutionContext;
  // Circuit-break runaway loops (design lens): both caps are enforced
  // independently, whichever trips first ends the run as `circuit_broken`
  // rather than letting a stuck loop spin on turns within a long timeout, or
  // a slow-but-not-looping run blow past a turn count that seemed safe.
  maxTurns?: number;
  maxDurationMs?: number;
  onEvent: (event: WorkerLoopEvent) => Promise<void> | void;
  now?: () => number;
  // THI-66: a single-use grant for one destructive call, set only by
  // convex/workerRunner.ts's resumeWorkerTask after an owner/CEO approves a
  // pending call. No conversation or sandbox state survives the pause (see
  // resumeWorkerTask's own comment for why) — a resumed run replays
  // `instructions` from scratch, so this grant is what lets the model's
  // retraced destructive call actually execute instead of pausing again.
  //
  // THI-73 Finding 1 / THI-74 Finding 3: bound to a hash of the exact full
  // arguments the human reviewed, not just the tool name and not just the
  // truncated display summary. A resumed run is a fresh LLM conversation —
  // nothing guarantees its first destructive call reproduces the same
  // arguments the owner/CEO actually approved (prompt injection in
  // `instructions`, or ordinary sampling variance, could steer it to
  // something else with the same tool name). Matching on name alone would
  // let that call execute unreviewed (Finding 1); matching on the
  // ARGS_SUMMARY_MAX_LENGTH-truncated argsSummary instead of the full
  // arguments still lets a resumed call diverge past the truncation
  // boundary and execute unreviewed (Finding 3, confirmed with a live PoC
  // against a >500-char run_shell command sharing only its prefix with what
  // was approved). Comparing a hash of the full, untruncated args closes
  // both gaps. Consumed on first match; a second destructive call later in
  // the same resumed run — even a matching one — still gates normally.
  approvedCall?: { toolName: string; argsHash: string };
}

const DEFAULT_MAX_TURNS = 20;
const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000;
const ARGS_SUMMARY_MAX_LENGTH = 500;

function summarizeArgs(args: Record<string, unknown>): string {
  let json: string;
  try {
    json = JSON.stringify(args);
  } catch {
    json = String(args);
  }
  return json.length > ARGS_SUMMARY_MAX_LENGTH
    ? `${json.slice(0, ARGS_SUMMARY_MAX_LENGTH)}…`
    : json;
}

// Deterministic regardless of the source object's own key insertion order —
// two calls with the same logical args must hash the same even if the LLM
// client (or a JSON round-trip) produced their keys in a different order,
// otherwise a legitimate resumed call could fail-closed-pause for the wrong
// reason (a UX bug, not a security one, but worth avoiding).
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

// THI-74 Finding 3: the full-fidelity binding for the destructive-call
// approval grant. Unlike summarizeArgs (truncated at ARGS_SUMMARY_MAX_LENGTH
// for human display), this hashes the complete, untruncated arguments, so
// two calls that only agree on their first ARGS_SUMMARY_MAX_LENGTH
// characters still hash differently and the approval gate below correctly
// treats them as a mismatch instead of a match.
export function hashToolArgs(args: Record<string, unknown>): string {
  let json: string;
  try {
    json = stableStringify(args);
  } catch {
    json = String(args);
  }
  return createHash("sha256").update(json).digest("hex");
}

export async function runWorkerLoop(opts: WorkerLoopOptions): Promise<WorkerLoopOutcome> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const tools = toolsForWorkerType(opts.workerType);
  const messages: LlmMessage[] = [{ role: "user", content: opts.instructions }];
  // Single-use grant (see WorkerLoopOptions.approvedCall) — cleared the
  // first time it's actually consumed so a second destructive call later in
  // this same run still gates normally rather than getting a free pass for
  // the rest of the task.
  let approvedCall = opts.approvedCall;

  for (let turn = 0; turn < maxTurns; turn++) {
    if (now() - startedAt > maxDurationMs) {
      return {
        status: "circuit_broken",
        turns: turn,
        failureReason: `exceeded_max_duration_ms:${maxDurationMs}`,
      };
    }

    const turnResult = await opts.llmClient.sendTurn({
      systemPrompt: opts.systemPrompt,
      messages,
      tools,
    });

    messages.push({ role: "assistant", text: turnResult.text, toolCalls: turnResult.toolCalls });

    if (turnResult.toolCalls.length === 0) {
      return { status: "completed", turns: turn + 1 };
    }

    for (const call of turnResult.toolCalls) {
      const argsSummary = summarizeArgs(call.input);
      await opts.onEvent({ kind: "tool_call", toolName: call.toolName, argsSummary });

      // THI-66: destructive-approval gate. Only intercepts a call that is
      // both registered for this workerType (an unregistered/hallucinated
      // tool name still falls through to the ordinary
      // assertToolAllowed/ToolNotAllowedError path below) and classified
      // destructive — and only when it doesn't match the single-use grant
      // this run was resumed with. The gate returns immediately: no
      // tool_result is logged for a call that never ran, and the loop ends
      // here rather than continuing to whatever the model proposes next.
      //
      // THI-73 Finding 1 / THI-74 Finding 3: the match is on toolName AND a
      // hash of the full args, not toolName alone (Finding 1) and not the
      // ARGS_SUMMARY_MAX_LENGTH-truncated argsSummary (Finding 3 — two
      // distinct commands that only share their first 500 chars produce the
      // same argsSummary but a different argsHash). A grant whose args
      // don't match what's about to execute is treated as no grant at all:
      // fail closed into a fresh pending-approval pause rather than
      // silently running.
      const isRegistered = tools.some((tool) => tool.name === call.toolName);
      if (isRegistered && isDestructiveToolCall(opts.workerType, call.toolName)) {
        const argsHash = hashToolArgs(call.input);
        if (
          approvedCall &&
          call.toolName === approvedCall.toolName &&
          argsHash === approvedCall.argsHash
        ) {
          approvedCall = undefined;
        } else {
          await opts.onEvent({ kind: "tool_call_pending_approval", toolName: call.toolName, argsSummary, argsHash });
          return {
            status: "awaiting_approval",
            turns: turn,
            pendingApproval: { toolName: call.toolName, argsSummary, argsHash },
          };
        }
      }

      let ok: boolean;
      let resultSummary: string;
      try {
        assertToolAllowed(opts.workerType, call.toolName);
        const execResult = await executeTool(
          opts.workerType,
          call.toolName,
          call.input,
          opts.toolContext,
        );
        ok = execResult.ok;
        resultSummary = execResult.resultSummary;
        if (execResult.fileDiff) {
          await opts.onEvent({
            kind: "file_diff",
            path: execResult.fileDiff.path,
            diffSummary: execResult.fileDiff.diffSummary,
          });
        }
      } catch (err) {
        ok = false;
        resultSummary = err instanceof Error ? err.message : String(err);
        // A denied tool call is a distinct audit event, not silently folded
        // into the tool_result — denials need to be visible on the task's
        // timeline as more than just "the tool_result happened to say
        // ok: false" (design lens: log denied/gated tool calls as typed
        // events, not silently). The destructive-approval gate above logs
        // its own tool_call_pending_approval event the same way.
        if (err instanceof ToolNotAllowedError) {
          await opts.onEvent({ kind: "error", message: resultSummary });
        }
      }

      await opts.onEvent({ kind: "tool_result", toolName: call.toolName, ok, resultSummary });
      messages.push({
        role: "tool",
        toolCallId: call.id,
        toolName: call.toolName,
        ok,
        resultSummary,
      });
    }
  }

  return {
    status: "circuit_broken",
    turns: maxTurns,
    failureReason: `exceeded_max_turns:${maxTurns}`,
  };
}
