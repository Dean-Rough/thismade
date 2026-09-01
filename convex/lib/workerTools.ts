import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
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

// THI-66: tool calls whose blast radius reaches past a worker's declared,
// narrow surface — file writes outside the ephemeral sandbox workspace,
// payments, sends to external systems — get a human-in-the-loop approval
// gate before they execute, distinct from the end-of-task needs_review gate
// (see convex/agentTasks.ts's requestToolApproval/resolveToolApproval).
// Only `run_shell` qualifies today: it's the one registered tool with
// genuinely open-ended reach (arbitrary shell + the sandbox's network
// egress can touch anything an external send or payment call would).
// Every other tool stays inside its own bounded, reversible action:
// read_file/write_file/list_directory resolve inside WORKSPACE_ROOT only
// (resolveWorkspacePath rejects escapes); navigate/click/read_page_text are
// read-only browser actions bounded by the navigate SSRF guard above;
// read_context_file/submit_draft touch nothing external. Extend this set
// the moment a tool that does reach payments or an external send is added.
const DESTRUCTIVE_TOOLS: Record<WorkerType, ReadonlySet<string>> = {
  coding: new Set(["run_shell"]),
  browser: new Set(),
  marketing: new Set(),
};

export function isDestructiveToolCall(workerType: WorkerType, toolName: string): boolean {
  return DESTRUCTIVE_TOOLS[workerType].has(toolName);
}

export interface ToolExecutionContext {
  sandbox?: SandboxHandle | null;
  readContextFile?: (fileKey: string) => Promise<string | null>;
  // Injected for testability (same pattern as `sandbox`/`readContextFile`):
  // production wiring leaves this unset and falls back to a real DNS lookup
  // (see `resolveHostnameAddresses`), tests inject a fake so
  // navigate-validation coverage never depends on live network/DNS.
  resolveHostnameAddresses?: (hostname: string) => Promise<string[]>;
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

// THI-71: the browser worker's prompt (workerPrompts.ts) tells the model it
// "cannot download files" and only navigates/reads/clicks, but nothing
// enforced that at the tool boundary — a `file://` URL plus read_page_text
// was an unintended second path to CODING_TOOLS' read_file, which browser
// workers are deliberately never given. This is the same defense-in-depth
// posture as resolveWorkspacePath's `..`-segment rejection above: E2B's
// sandbox network isolation is a second layer, not the only one.
const ALLOWED_NAVIGATE_PROTOCOLS = new Set(["http:", "https:"]);

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".");
  if (octets.length !== 4) return true;
  const parts = octets.map(Number);
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 - unspecified / "this network"
  if (a === 127) return true; // 127.0.0.0/8 - loopback
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 - link-local + cloud metadata (169.254.169.254)
  return false;
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified
  const ipv4Mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped) return isBlockedIpv4(ipv4Mapped[1]);
  const firstHextet = parseInt(normalized.split(":")[0] || "", 16);
  if (Number.isNaN(firstHextet)) return true; // unparseable - fail closed
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true; // fc00::/7 - unique local
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // fe80::/10 - link-local
  return false;
}

function isBlockedIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true; // not a recognizable IP literal - fail closed rather than guess
}

async function resolveHostnameAddresses(hostname: string): Promise<string[]> {
  const records = await dnsLookup(hostname, { all: true });
  return records.map((record) => record.address);
}

// Validates a navigate() target before it ever reaches the sandbox's
// Playwright driver: rejects non-http(s) schemes (file:, javascript:, data:,
// …) and rejects loopback/private/link-local/metadata-range IPs, whether
// given as a literal or reached by resolving a hostname. Fails closed on any
// parse/lookup failure - an unverifiable target is not a safe target.
async function validateNavigationUrl(
  rawUrl: string,
  resolveHostname: (hostname: string) => Promise<string[]>,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`navigate_blocked:unparseable_url:${rawUrl}`);
  }

  if (!ALLOWED_NAVIGATE_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`navigate_blocked:disallowed_scheme:${parsed.protocol}`);
  }

  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (!hostname) {
    throw new Error(`navigate_blocked:missing_host:${rawUrl}`);
  }

  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new Error(`navigate_blocked:private_address:${hostname}`);
    }
    return;
  }

  let addresses: string[];
  try {
    addresses = await resolveHostname(hostname);
  } catch {
    throw new Error(`navigate_blocked:dns_resolution_failed:${hostname}`);
  }
  if (addresses.length === 0 || addresses.some((address) => isBlockedIpAddress(address))) {
    throw new Error(`navigate_blocked:private_address:${hostname}`);
  }
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
      const url = String(args.url ?? "");
      await validateNavigationUrl(url, ctx.resolveHostnameAddresses ?? resolveHostnameAddresses);
      return runBrowserAction(ctx.sandbox, "navigate", { url });
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
