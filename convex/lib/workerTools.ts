import type { SandboxHandle } from "./sandboxProvider";

export type WorkerType = "coding" | "browser" | "marketing";

export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, { type: string; description?: string }>;
  required: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
}

// Least privilege by construction (THI-66's stated future requirement,
// enforced here at the point of registration): each workerType's tool set is
// its own closed list, not a shared toolbox with a runtime filter bolted on.
// A "marketing" worker has no tool that touches a shell or the filesystem at
// all — see convex/workerRunner.ts for why marketing tasks don't even get a
// sandbox provisioned.
const CODING_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a text file's contents from the sandbox workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the workspace root." } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Create or overwrite a text file in the sandbox workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_shell",
    description: "Run a shell command inside the sandbox workspace (e.g. install deps, run tests).",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "list_directory",
    description: "List entries in a sandbox workspace directory.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the workspace root; \".\" for the root." } },
      required: ["path"],
    },
  },
];

const BROWSER_TOOLS: ToolDefinition[] = [
  {
    name: "navigate",
    description: "Navigate the sandboxed headless browser to a URL.",
    parameters: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
    },
  },
  {
    name: "read_page_text",
    description: "Return the visible text content of the current page.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "click",
    description: "Click the first element matching a CSS selector on the current page.",
    parameters: {
      type: "object",
      properties: { selector: { type: "string" } },
      required: ["selector"],
    },
  },
];

const MARKETING_TOOLS: ToolDefinition[] = [
  {
    name: "read_context_file",
    description: "Read one of the business's canonical context files for grounding.",
    parameters: {
      type: "object",
      properties: {
        fileKey: {
          type: "string",
          description: "One of SOUL, OWNER, BUSINESS, PLATFORM, PLAYBOOK.",
        },
      },
      required: ["fileKey"],
    },
  },
  {
    name: "submit_draft",
    description: "Submit the final drafted copy for this task.",
    parameters: {
      type: "object",
      properties: { content: { type: "string" } },
      required: ["content"],
    },
  },
];

const TOOLS_BY_WORKER_TYPE: Record<WorkerType, ToolDefinition[]> = {
  coding: CODING_TOOLS,
  browser: BROWSER_TOOLS,
  marketing: MARKETING_TOOLS,
};

export function toolsForWorkerType(workerType: WorkerType): ToolDefinition[] {
  return TOOLS_BY_WORKER_TYPE[workerType];
}

export class ToolNotAllowedError extends Error {
  constructor(
    public readonly workerType: WorkerType,
    public readonly toolName: string,
  ) {
    super(`tool_not_allowed:${workerType}:${toolName}`);
  }
}

// The chokepoint THI-66 scopes its destructive-approval-gate work against.
// THI-68 ships the enforcement point and a minimal allow list (tool
// registration above *is* the allowlist); a per-call human-approval gate for
// destructive calls within an already-allowed tool (e.g. run_shell) is
// deliberately not built here — that's THI-66's job, layered on top of this
// same call site.
export function assertToolAllowed(workerType: WorkerType, toolName: string): void {
  const allowed = TOOLS_BY_WORKER_TYPE[workerType].some((tool) => tool.name === toolName);
  if (!allowed) {
    throw new ToolNotAllowedError(workerType, toolName);
  }
}

export interface ToolExecutionContext {
  sandbox?: SandboxHandle | null;
  readContextFile?: (fileKey: string) => Promise<string | null>;
}

export interface ToolExecutionResult {
  ok: boolean;
  resultSummary: string;
  fileDiff?: { path: string; diffSummary: string };
}

const SUMMARY_MAX_LENGTH = 2_000;

function truncate(text: string, maxLength = SUMMARY_MAX_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n…truncated (${text.length - maxLength} more chars)`;
}

// Workspace root for coding/browser sandboxes. Every path-taking tool
// resolves against this and rejects anything that would escape it (`..`
// segments, absolute paths) — the sandbox itself is already isolated from
// the host per the sandbox-only-execution design lens, but a coding worker's
// `path` argument can be influenced by untrusted input the same way its
// dispatch `instructions` can (THI-62's `containsUntrustedContent` case), so
// this stays defense-in-depth rather than trusting the sandbox boundary
// alone to cover it.
const WORKSPACE_ROOT = "/home/user/workspace";

function resolveWorkspacePath(rawPath: string): string {
  const segments = rawPath.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.some((segment) => segment === "..")) {
    throw new Error(`path_escapes_workspace:${rawPath}`);
  }
  return [WORKSPACE_ROOT, ...segments].join("/");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// A fresh Playwright launch per call, restoring only the last-visited URL
// (not full DOM/session state) between calls — simple and correct rather
// than fast. A persistent in-sandbox driver process is the natural follow-up
// once this loop has live E2B credentials to actually benchmark against; see
// the THI-68 plan document's "explicitly out of scope" list.
const BROWSER_DRIVER_PATH = "/tmp/thismade-browser-driver.mjs";
const BROWSER_STATE_PATH = "/tmp/thismade-browser-state.json";
const BROWSER_READY_MARKER = "/tmp/.thismade-browser-ready";

const BROWSER_DRIVER_SCRIPT = `
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const STATE_PATH = ${JSON.stringify(BROWSER_STATE_PATH)};
const [, , action, argsJson] = process.argv;
const args = JSON.parse(argsJson || "{}");

function loadState() {
  if (!existsSync(STATE_PATH)) return { url: null };
  return JSON.parse(readFileSync(STATE_PATH, "utf8"));
}
function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state));
}

const browser = await chromium.launch();
const page = await browser.newPage();
const state = loadState();
let result = { ok: true };
try {
  if (state.url) {
    await page.goto(state.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  }
  if (action === "navigate") {
    await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    state.url = page.url();
    result.url = state.url;
  } else if (action === "click") {
    await page.click(args.selector, { timeout: 10000 });
    state.url = page.url();
    result.url = state.url;
  } else if (action === "read_page_text") {
    result.text = await page.innerText("body");
  } else {
    throw new Error("unknown_action:" + action);
  }
  saveState(state);
} catch (err) {
  result = { ok: false, error: String(err && err.message ? err.message : err) };
} finally {
  await browser.close();
}
process.stdout.write(JSON.stringify(result));
`;

async function ensureBrowserDriverReady(sandbox: SandboxHandle): Promise<void> {
  const marker = await sandbox.runCommand(`test -f ${BROWSER_READY_MARKER} && echo present || echo absent`);
  if (marker.stdout.trim() === "present") {
    return;
  }
  await sandbox.writeFile(BROWSER_DRIVER_PATH, BROWSER_DRIVER_SCRIPT);
  const install = await sandbox.runCommand(
    "npm install --no-save playwright && npx playwright install --with-deps chromium",
    { timeoutMs: 300_000 },
  );
  if (install.exitCode !== 0) {
    throw new Error(`browser_bootstrap_failed:${truncate(install.stderr)}`);
  }
  await sandbox.runCommand(`touch ${BROWSER_READY_MARKER}`);
}

async function runBrowserAction(
  sandbox: SandboxHandle,
  action: "navigate" | "click" | "read_page_text",
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  await ensureBrowserDriverReady(sandbox);
  const argsJson = shellQuote(JSON.stringify(args));
  const result = await sandbox.runCommand(`node ${BROWSER_DRIVER_PATH} ${action} ${argsJson}`, {
    timeoutMs: 60_000,
  });
  if (result.exitCode !== 0) {
    return { ok: false, resultSummary: truncate(result.stderr || result.stdout) };
  }
  let parsed: { ok: boolean; text?: string; url?: string; error?: string };
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, resultSummary: truncate(`unparseable_driver_output: ${result.stdout}`) };
  }
  if (!parsed.ok) {
    return { ok: false, resultSummary: truncate(parsed.error ?? "browser_action_failed") };
  }
  const summary = parsed.text ? truncate(parsed.text) : (parsed.url ?? "ok");
  return { ok: true, resultSummary: summary };
}

// Executes one already-allowlisted tool call. Callers must call
// assertToolAllowed first (convex/workerRunner.ts does, before logging the
// tool_call event) — this function re-asserts it too so it can never be
// called out of band with an unregistered tool.
export async function executeTool(
  workerType: WorkerType,
  toolName: string,
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult> {
  assertToolAllowed(workerType, toolName);

  switch (toolName) {
    case "read_file": {
      if (!ctx.sandbox) throw new Error("sandbox_required");
      const path = resolveWorkspacePath(String(args.path ?? ""));
      const content = await ctx.sandbox.readFile(path);
      return { ok: true, resultSummary: truncate(content) };
    }
    case "write_file": {
      if (!ctx.sandbox) throw new Error("sandbox_required");
      const rawPath = String(args.path ?? "");
      const path = resolveWorkspacePath(rawPath);
      const content = String(args.content ?? "");
      await ctx.sandbox.writeFile(path, content);
      return {
        ok: true,
        resultSummary: `wrote ${content.length} bytes to ${rawPath}`,
        fileDiff: { path: rawPath, diffSummary: truncate(`+${content.length} bytes\n${content}`) },
      };
    }
    case "run_shell": {
      if (!ctx.sandbox) throw new Error("sandbox_required");
      const command = String(args.command ?? "");
      const result = await ctx.sandbox.runCommand(`cd ${shellQuote(WORKSPACE_ROOT)} && ${command}`);
      const summary = `exit ${result.exitCode}\n${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`;
      return { ok: result.exitCode === 0, resultSummary: truncate(summary) };
    }
    case "list_directory": {
      if (!ctx.sandbox) throw new Error("sandbox_required");
      const path = resolveWorkspacePath(String(args.path ?? "."));
      const result = await ctx.sandbox.runCommand(`ls -la ${shellQuote(path)}`);
      return { ok: result.exitCode === 0, resultSummary: truncate(result.stdout || result.stderr) };
    }
    case "navigate": {
      if (!ctx.sandbox) throw new Error("sandbox_required");
      return runBrowserAction(ctx.sandbox, "navigate", { url: String(args.url ?? "") });
    }
    case "click": {
      if (!ctx.sandbox) throw new Error("sandbox_required");
      return runBrowserAction(ctx.sandbox, "click", { selector: String(args.selector ?? "") });
    }
    case "read_page_text": {
      if (!ctx.sandbox) throw new Error("sandbox_required");
      return runBrowserAction(ctx.sandbox, "read_page_text", {});
    }
    case "read_context_file": {
      if (!ctx.readContextFile) throw new Error("read_context_file_unavailable");
      const content = await ctx.readContextFile(String(args.fileKey ?? ""));
      return { ok: content !== null, resultSummary: content ? truncate(content) : "not_found" };
    }
    case "submit_draft": {
      const content = String(args.content ?? "");
      return {
        ok: true,
        resultSummary: `submitted draft, ${content.length} chars`,
        fileDiff: { path: "draft.md", diffSummary: truncate(content) },
      };
    }
    default:
      // Unreachable: assertToolAllowed already rejected anything not in the
      // registry above, and every registered name is handled above.
      throw new Error(`unhandled_tool:${toolName}`);
  }
}
