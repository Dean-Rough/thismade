import { generateText, jsonSchema, tool } from "ai";
import type { ModelMessage, Tool } from "ai";
import type { ToolDefinition } from "./workerTools";

// Model routed through Vercel AI Gateway ("provider/model" string), per this
// build's Vercel guidance — no provider-specific SDK package needed. No
// gateway/provider credential is provisioned in this environment as of
// THI-68 (see the plan document); a missing credential surfaces as a normal
// caught error from generateText, handled the same way a missing
// E2B_API_KEY is (see convex/lib/sandboxProvider.ts).
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";

export interface LlmToolCall {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
}

export type LlmMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; text: string; toolCalls: LlmToolCall[] }
  | { role: "tool"; toolCallId: string; toolName: string; ok: boolean; resultSummary: string };

export interface LlmTurnResult {
  text: string;
  toolCalls: LlmToolCall[];
  finishReason: "tool_calls" | "stop" | "other";
}

// One LLM call = one turn, tool calls returned but never auto-executed
// (registered tools below have no `execute`) — convex/lib/workerLoop.ts owns
// the actual multi-turn loop so it can log a typed tool_call/tool_result
// event around every single tool execution, not just the finished sequence.
export interface LlmClient {
  sendTurn(opts: {
    systemPrompt: string;
    messages: LlmMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmTurnResult>;
}

function toModelMessages(messages: LlmMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === "user") {
      return { role: "user", content: message.content };
    }
    if (message.role === "assistant") {
      return {
        role: "assistant",
        content: [
          ...(message.text ? [{ type: "text" as const, text: message.text }] : []),
          ...message.toolCalls.map((call) => ({
            type: "tool-call" as const,
            toolCallId: call.id,
            toolName: call.toolName,
            input: call.input,
          })),
        ],
      };
    }
    return {
      role: "tool",
      content: [
        {
          type: "tool-result" as const,
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          output: { type: "text" as const, value: message.resultSummary },
        },
      ],
    };
  });
}

function toAiSdkTools(tools: ToolDefinition[]): Record<string, Tool> {
  const entries = tools.map((definition) => [
    definition.name,
    tool({
      description: definition.description,
      // No `execute`: this registers the tool's shape for the model without
      // letting the AI SDK run it — execution stays entirely in
      // convex/lib/workerLoop.ts's manual loop, see the LlmClient doc above.
      inputSchema: jsonSchema(definition.parameters as unknown as Record<string, unknown>),
    }),
  ]);
  return Object.fromEntries(entries);
}

function mapFinishReason(reason: string): LlmTurnResult["finishReason"] {
  if (reason === "tool-calls") return "tool_calls";
  if (reason === "stop") return "stop";
  return "other";
}

export class AiSdkLlmClient implements LlmClient {
  constructor(private readonly model: string = process.env.WORKER_LLM_MODEL ?? DEFAULT_MODEL) {}

  async sendTurn(opts: {
    systemPrompt: string;
    messages: LlmMessage[];
    tools: ToolDefinition[];
  }): Promise<LlmTurnResult> {
    const result = await generateText({
      model: this.model,
      system: opts.systemPrompt,
      messages: toModelMessages(opts.messages),
      tools: toAiSdkTools(opts.tools),
    });

    return {
      text: result.text,
      toolCalls: result.toolCalls.map((call) => ({
        id: call.toolCallId,
        toolName: call.toolName,
        input: (call.input ?? {}) as Record<string, unknown>,
      })),
      finishReason: mapFinishReason(result.finishReason),
    };
  }
}
