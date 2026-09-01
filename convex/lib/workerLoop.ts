import type { LlmClient, LlmMessage } from "./llmClient";
import {
  assertToolAllowed,
  executeTool,
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
  | { kind: "error"; message: string };

export interface WorkerLoopOutcome {
  status: "completed" | "circuit_broken";
  turns: number;
  failureReason?: string;
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

export async function runWorkerLoop(opts: WorkerLoopOptions): Promise<WorkerLoopOutcome> {
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  const tools = toolsForWorkerType(opts.workerType);
  const messages: LlmMessage[] = [{ role: "user", content: opts.instructions }];

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
      await opts.onEvent({
        kind: "tool_call",
        toolName: call.toolName,
        argsSummary: summarizeArgs(call.input),
      });

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
        // into the tool_result — THI-66's future approval-gate work needs
        // denials to be visible on the task's timeline as more than just
        // "the tool_result happened to say ok: false" (design lens: log
        // denied/gated tool calls as typed events, not silently).
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
