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

export interface NavigationHopPlan {
  hostname: string;
  // A "MAP <hostname> <ip1>,<ip2>,…" host-resolver-rules directive to pin
  // this hostname to the exact address(es) just validated, or null when
  // there's nothing to pin: the hostname is already pinned from an earlier
  // hop (reuse it, don't re-resolve - see below) or was itself an IP
  // literal (no DNS involved, nothing can rebind).
  newHostResolverRule: string | null;
}

// THI-72: the tested, single source of truth for how the sandboxed browser
// driver decides whether to allow one navigation hop (the navigate() target
// itself, or a same-call redirect/subresource target) through, and whether
// it needs a fresh DNS resolution or can reuse a hop already pinned earlier
// in the same call. This is deliberately reusable for that purpose, not just
// a helper for validateNavigationUrl below: it's what closes the DNS-
// rebinding TOCTOU gap, by refusing to re-resolve a hostname once it's been
// pinned (an attacker flipping DNS between hop N and hop N+1 for the *same*
// hostname can't get a different answer once we've committed to one), and by
// giving each redirect hop its own resolve-then-immediately-pin step instead
// of validating the first URL and then letting every hop after it go
// unchecked. BROWSER_DRIVER_SCRIPT's `pinHostname` is a hand-written mirror
// of this exact algorithm - it can't import this module, since it runs as a
// wholly separate Node process inside the E2B sandbox - so treat this
// function as the spec that mirror must match.
export async function planNavigationHop(
  rawUrl: string,
  alreadyPinnedHostnames: ReadonlySet<string>,
  resolveHostname: (hostname: string) => Promise<string[]>,
): Promise<NavigationHopPlan> {
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
    return { hostname, newHostResolverRule: null };
  }

  if (alreadyPinnedHostnames.has(hostname)) {
    return { hostname, newHostResolverRule: null };
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
  return { hostname, newHostResolverRule: `MAP ${hostname} ${addresses.join(",")}` };
}

// Validates a navigate() target before it's even sent to the sandbox as a
// command: rejects non-http(s) schemes (file:, javascript:, data:, …) and
// rejects loopback/private/link-local/metadata-range IPs, whether given as a
// literal or reached by resolving a hostname. Fails closed on any
// parse/lookup failure - an unverifiable target is not a safe target.
//
// THI-72: this is a fail-fast pre-check, not the DNS-rebinding boundary - it
// runs in the Convex process, and by the time its answer reaches the
// sandbox's Playwright driver (a `runCommand` round trip later, possibly
// after an npm install), the resolution it saw can be stale. It still earns
// its keep by rejecting obviously-bad targets before spending a sandbox
// command on them, but the actual enforcement now also happens inside the
// driver itself via planNavigationHop's pin-then-connect sequencing, which
// runs in the same process that opens the connection.
async function validateNavigationUrl(
  rawUrl: string,
  resolveHostname: (hostname: string) => Promise<string[]>,
): Promise<void> {
  await planNavigationHop(rawUrl, new Set(), resolveHostname);
}

// THI-75: Chromium can act on <link rel="preconnect"> and
// <link rel="dns-prefetch"> before any page script runs - preconnect opens a
// real TCP/TLS connection as a warm-up with no HTTP request ever sent over
// it, and dns-prefetch is a bare DNS lookup with no request at all, so
// neither reliably surfaces as a Network-domain event the way an ordinary
// subresource fetch does. That means either one could reach an attacker-
// chosen host without ever passing through the pin/abort logic
// planNavigationHop and the driver's mirrored pinHostname enforce. Stripping
// these tags out of every document response before Chromium's HTML parser
// sees them closes the gap regardless of whether a given Chromium build
// happens to route preconnect through the same interception path as a
// normal fetch. Exported so workerTools.test.ts can exercise it directly;
// the mirror of this exact function ships as JS text inside
// BROWSER_DRIVER_SCRIPT below (same "can't import this module from inside
// the sandbox" reason as isBlockedIpv4/isBlockedIpv6).
// THI-81 Finding 2: the previous `[^>]*` tag matcher didn't understand HTML
// attribute quoting, so a literal `>` inside a quoted attribute value
// (placed before rel=) ended the match early and the truncated tag never
// contained "rel=", making this a silent no-op. The quote-aware alternation
// below treats a quoted value as one atomic unit (matching Chromium's actual
// tokenizer behavior for this case) so an embedded `>` can't end the tag
// early. That same "search for the first rel= substring anywhere in the
// tag" approach also let an earlier decoy attribute whose *value* happens to
// contain the text "rel=" hide a later real rel attribute from the old
// single-match regex; scanning every attribute in sequence (each consumed as
// an atomic name=value unit, so a decoy's quoted value can never be
// mistaken for a separate attribute) and blocking if any of them is a real
// rel="preconnect|dns-prefetch" closes that too.
export function stripSpeculativeLinkTags(html: string): string {
  return html.replace(/<link\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, (tag) => {
    const attrPattern = /([a-zA-Z][-a-zA-Z0-9]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrPattern.exec(tag))) {
      if (attrMatch[1].toLowerCase() !== "rel") continue;
      const relValue = attrMatch[2].replace(/^["']|["']$/g, "");
      if (hasBlockedLinkRel(relValue)) {
        return "<!-- thismade: stripped speculative link -->";
      }
    }
    return tag;
  });
}

// THI-79: stripSpeculativeLinkTags only ever sees the literal HTTP response
// body - it does nothing to stop page JS from creating a
// rel=preconnect|dns-prefetch <link> via DOM APIs at runtime
// (document.createElement + appendChild), which Chromium's LinkLoader honors
// regardless of how the element was created. This closes that gap the same
// way THI-75 closed WebRTC: an addInitScript that neutralizes the element the
// moment it would take effect, before any page script runs. The predicate and
// transform are plain functions so this test file can exercise the DOM-
// injection defense directly (this environment has no live E2B/Chromium to
// drive real DOM mutation through); the mirror ships as JS text inside
// BROWSER_DRIVER_SCRIPT's addInitScript callback (same "can't import this
// module from inside the sandbox" reason as isBlockedIpv4/
// stripSpeculativeLinkTags above) since addInitScript's callback runs in the
// browser's own JS realm, not this Node process.
const BLOCKED_LINK_RELS = new Set(["preconnect", "dns-prefetch"]);

export function hasBlockedLinkRel(relValue: string | null | undefined): boolean {
  return String(relValue ?? "")
    .toLowerCase()
    .split(/\s+/)
    .some((token) => BLOCKED_LINK_RELS.has(token));
}

export interface MinimalLinkElement {
  tagName: string;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

// Strips the blocked rel and drops href so the element can no longer trigger
// a preconnect/dns-prefetch, whether it's about to be attached to the
// document (appendChild/insertBefore) or already is (rel/setAttribute
// mutated after insertion). Returns whether it neutralized anything so
// callers can decide whether an element needs no further handling.
export function neutralizeSpeculativeLinkElement(el: MinimalLinkElement): boolean {
  if (el.tagName !== "LINK" || !hasBlockedLinkRel(el.getAttribute("rel"))) {
    return false;
  }
  el.setAttribute("rel", "");
  el.removeAttribute("href");
  return true;
}

// A fresh Playwright launch per call, restoring only the last-visited URL
// (not full DOM/session state) between calls — simple and correct rather
// than fast. A persistent in-sandbox driver process is the natural follow-up
// once this loop has live E2B credentials to actually benchmark against; see
// the THI-68 plan document's "explicitly out of scope" list.
const BROWSER_DRIVER_PATH = "/tmp/thismade-browser-driver.mjs";
const BROWSER_STATE_PATH = "/tmp/thismade-browser-state.json";
const BROWSER_READY_MARKER = "/tmp/.thismade-browser-ready";

// THI-72: caps how many times navigateWithPinning will relaunch Chromium to
// pin a newly-seen hostname reached mid-navigation (a redirect chain, or a
// page that bounces through several hosts). This is the circuit breaker for
// that loop - without it, a malicious/misconfigured redirect chain that
// keeps bouncing to fresh hostnames would relaunch the browser indefinitely
// instead of failing closed.
const MAX_REDIRECT_HOPS = 3;

// Exported so a test can syntax-check the exact text written into the
// sandbox (see workerTools.test.ts) - this environment has no E2B
// credentials to actually execute it, so a parse check is the best
// available guard against a template-literal escaping mistake shipping
// silently.
export const BROWSER_DRIVER_SCRIPT = `
import { chromium } from "playwright";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID } from "node:crypto";

const STATE_PATH = ${JSON.stringify(BROWSER_STATE_PATH)};
const MAX_REDIRECT_HOPS = ${JSON.stringify(MAX_REDIRECT_HOPS)};
const [, , action, argsJson] = process.argv;
const args = JSON.parse(argsJson || "{}");

// THI-79: collects the "this silently fell back" / "this silently kept
// running" signals that used to vanish into an empty catch block - both from
// this Node process directly (allowRequest below) and relayed from the
// browser's own console (see the page.on("console", ...) listener in
// navigateWithPinning), since addInitScript callbacks run in the page's JS
// realm and can't write to this process's stdout/stderr directly. Folded into
// the final result object so it rides the same runCommand stdout capture
// path executeTool/runBrowserAction already reads resultSummary from -
// callers get an observable trail instead of a silent fallback.
const diagnostics = [];
// THI-80 Finding 2: the page-console relay below used to match on the static
// literal "thismade:" - any navigated page can call console.error with that
// exact prefix itself, forging a "trusted" diagnostic (or drowning real ones
// in noise) since console.error is an ordinary page-callable API. Generating
// a fresh unpredictable token per process invocation and requiring the relay
// to match it instead closes that: the token is passed into addInitScript as
// a function argument (never assigned to window or otherwise exposed to page
// script), so a page has no way to read or reproduce it.
const DIAG_TOKEN = randomUUID();
function errMessage(err) {
  return err && err.message ? err.message : String(err);
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { url: null, hostResolverRules: [] };
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  state.hostResolverRules = state.hostResolverRules || [];
  return state;
}
function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state));
}

// THI-72: hand-written mirror of convex/lib/workerTools.ts's
// isBlockedIpv4/isBlockedIpv6/isBlockedIpAddress. This script runs as a
// separate Node process inside the E2B sandbox and can't import that module,
// so the blocklist is duplicated here rather than shared at runtime - keep
// the two in sync by hand.
function isBlockedIpv4(address) {
  const octets = address.split(".");
  if (octets.length !== 4) return true;
  const parts = octets.map(Number);
  if (parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return true;
  const a = parts[0];
  const b = parts[1];
  if (a === 0) return true;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}
function isBlockedIpv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  const mapped = normalized.match(/^::ffff:(\\d+\\.\\d+\\.\\d+\\.\\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);
  const first = parseInt(normalized.split(":")[0] || "", 16);
  if (Number.isNaN(first)) return true;
  if (first >= 0xfc00 && first <= 0xfdff) return true;
  if (first >= 0xfe80 && first <= 0xfebf) return true;
  return false;
}
function isBlockedIpAddress(address) {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function parseHostname(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("navigate_blocked:unparseable_url:" + rawUrl);
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new Error("navigate_blocked:disallowed_scheme:" + parsed.protocol);
  }
  const hostname = parsed.hostname.replace(/^\\[/, "").replace(/\\]$/, "");
  if (!hostname) {
    throw new Error("navigate_blocked:missing_host:" + rawUrl);
  }
  return hostname;
}

// Mirrors convex/lib/workerTools.ts's planNavigationHop: resolves and
// validates a hostname once, then pins it via a host-resolver-rules MAP
// directive so Chromium connects to exactly the address just validated
// instead of doing its own independent (and possibly rebound) lookup. A
// hostname already pinned this call is reused rather than re-resolved -
// re-resolving on every hop would reopen the same rebinding window for
// repeat visits to the same host within one navigation chain.
async function pinHostname(hostname, existingRules) {
  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new Error("navigate_blocked:private_address:" + hostname);
    }
    return null;
  }
  const already = existingRules.some((rule) => rule.startsWith("MAP " + hostname + " "));
  if (already) return null;
  let addresses;
  try {
    addresses = (await lookup(hostname, { all: true })).map((r) => r.address);
  } catch {
    throw new Error("navigate_blocked:dns_resolution_failed:" + hostname);
  }
  if (addresses.length === 0 || addresses.some(isBlockedIpAddress)) {
    throw new Error("navigate_blocked:private_address:" + hostname);
  }
  return "MAP " + hostname + " " + addresses.join(",");
}

// Navigates to targetUrl, relaunching Chromium with an extended
// --host-resolver-rules set whenever the navigation (the initial load, or a
// same-call redirect it follows) reaches a hostname not yet pinned. Every
// request the page makes - not just the top-level navigation - is checked
// through the same context.route() interceptor before Chromium is allowed to
// touch it, so a redirect or a subresource load can't reach an unpinned host
// unchecked. THI-72: this is what ties the IP validated at resolve time to
// the IP actually connected to, for every hop, instead of validating one URL
// up front and then trusting whatever the browser's own resolver does next.
//
// THI-72 follow-up: page.route() only ever covers the single page it's
// registered on, and Playwright never routes WebSocket connections through
// it at all - so a scraped/prompt-injected page's own JS could previously
// reach an unpinned/unvalidated host via window.open(...) (a second,
// unrouted page) or new WebSocket(...) with zero DNS pinning. Registering
// on the context instead of the page covers every page the context ever
// creates (including popups), closing spawned popups outright removes the
// unrouted-second-page window entirely, and routeWebSocket()/blocking
// service workers closes the other two request paths context.route() still
// can't see.
//
// THI-75: three more gaps in the same interception model, all lower
// severity than the ones above because none give a page a way to read
// arbitrary internal content back through itself - see the ticket for the
// full severity reasoning:
//   1. RTCPeerConnection's ICE candidate gathering can enumerate the
//      sandbox's local/internal network interfaces with zero HTTP(S) or
//      WebSocket request for context.route()/routeWebSocket() to see - none
//      of navigate/click/read_page_text have any legitimate use for WebRTC,
//      so the API is removed from every frame via an init script below.
//   2. dns-prefetch is a bare DNS lookup with no HTTP request at all, so
//      there's nothing for context.route() to intercept even in principle -
//      closed two ways: stripSpeculativeLinkTags removes the <link> trigger
//      from every document body, and --dns-prefetch-disable turns the
//      browser feature off outright as a second layer (it also covers
//      Chromium's other prefetch triggers, e.g. a Link response header,
//      that a body rewrite alone wouldn't reach).
//   3. preconnect opens a real TCP/TLS connection as a warm-up with no HTTP
//      request ever sent over it, so it's unverified (no live E2B sandbox to
//      check against) whether it surfaces as a Network-domain event the way
//      an ordinary fetch does - closed via the same stripSpeculativeLinkTags
//      rewrite regardless of the answer.
function stripSpeculativeLinkTags(html) {
  return html.replace(/<link\\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, (tag) => {
    const attrPattern = /([a-zA-Z][-a-zA-Z0-9]*)\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)/g;
    let attrMatch;
    while ((attrMatch = attrPattern.exec(tag))) {
      if (attrMatch[1].toLowerCase() !== "rel") continue;
      const relValue = attrMatch[2].replace(/^["']|["']$/g, "").toLowerCase();
      const relTokens = relValue.split(/\\s+/).filter(Boolean);
      if (relTokens.includes("preconnect") || relTokens.includes("dns-prefetch")) {
        return "<!-- thismade: stripped speculative link -->";
      }
    }
    return tag;
  });
}

// maxRedirects: 0 on the route.fetch() below is load-bearing, not
// incidental: without it, route.fetch() would silently follow a 3xx
// response itself using Playwright's own request client, which never
// re-enters context.route() - that would let a redirect skip the per-hop
// DNS-pinning/private-IP check the outer loop in navigateWithPinning depends
// on entirely. Falling back to route.continue() for a redirect response
// hands it back to the normal CDP request flow instead, where it surfaces as
// a fresh request and gets re-validated by this same handler exactly like
// every other hop already is.
async function allowRequest(route) {
  if (route.request().resourceType() === "document") {
    let response;
    try {
      response = await route.fetch({ maxRedirects: 0 });
    } catch (err) {
      // THI-79: no response was ever obtained, so nothing unstripped could
      // have shipped - falling back to the normal CDP request flow is still
      // safe. But this used to be silent: a host the attacker controls
      // (already pinned-but-untrusted, exactly this driver's threat model)
      // could trigger route.fetch() failures on demand with zero signal.
      // Log so the fallback is observable instead.
      diagnostics.push("allowRequest: route.fetch() failed, falling back to unmodified continue(): " + errMessage(err));
      await route.continue();
      return;
    }
    const status = response.status();
    if (status >= 300 && status < 400) {
      await route.continue();
      return;
    }
    try {
      const body = await response.text();
      await route.fulfill({ response, body: stripSpeculativeLinkTags(body) });
      return;
    } catch (err) {
      // THI-79: a response was obtained but reading/rewriting it failed -
      // the previous behaviour fell back to route.continue() here too,
      // which would serve the document completely unstripped and gave an
      // attacker-controlled host a way to trigger this exact fallback on
      // demand. Abort instead: failing the navigation is safer than
      // silently shipping unstripped <link rel=preconnect|dns-prefetch>
      // markup, and log it so the abort's cause is observable.
      diagnostics.push(
        "allowRequest: response rewrite failed, aborting navigation instead of serving unstripped content: " + errMessage(err),
      );
      await route.abort("blockedbyclient");
      return;
    }
  }
  await route.continue();
}

async function navigateWithPinning(targetUrl, rules) {
  let currentRules = rules.slice();
  let pendingUrl = targetUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    const hostname = parseHostname(pendingUrl);
    const rule = await pinHostname(hostname, currentRules);
    if (rule) currentRules.push(rule);

    const launchArgs = [
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--dns-prefetch-disable",
    ];
    if (currentRules.length) {
      launchArgs.push("--host-resolver-rules=" + currentRules.join(","));
    }
    const browser = await chromium.launch({ args: launchArgs });
    const context = await browser.newContext({ serviceWorkers: "block" });
    context.on("page", (extraPage) => {
      extraPage.close().catch(() => {});
    });
    await context.routeWebSocket("**/*", (route) => route.close());
    // THI-75: belt-and-suspenders alongside --force-webrtc-ip-handling-policy
    // above - remove the constructors outright so a page can't construct an
    // RTCPeerConnection at all, rather than relying only on a Chromium launch
    // flag whose exact ICE-gathering behavior isn't independently verified
    // here. Runs on every frame this context ever creates, including popups,
    // before any page script does.
    await context.addInitScript((diagToken) => {
      for (const name of ["RTCPeerConnection", "webkitRTCPeerConnection"]) {
        try {
          Object.defineProperty(window, name, {
            configurable: false,
            get() {
              throw new Error(name + " is disabled in this sandbox");
            },
          });
        } catch (err) {
          // THI-79: the only *expected* throw here is "already
          // non-configurable" (a Chromium build that ships the property
          // that way already) - in that case there's nothing more to do,
          // the property can't be redefined by page script either. Any
          // other throw reason means the lockdown didn't happen and
          // RTCPeerConnection is still live with zero signal, so verify the
          // assumption instead of silently swallowing every throw.
          const descriptor = Object.getOwnPropertyDescriptor(window, name);
          if (!descriptor || descriptor.configurable !== false) {
            console.error(
              diagToken + ": failed to lock down " + name + ": " + (err && err.message ? err.message : String(err)),
            );
          }
        }
      }

      // THI-79: stripSpeculativeLinkTags (below, applied to the raw response
      // body in allowRequest) does nothing to stop page JS from creating a
      // rel=preconnect|dns-prefetch <link> at runtime via DOM APIs, which
      // Chromium's LinkLoader honors regardless of how the element arrived.
      // Neutralize any such element the moment it would take effect: strip
      // the blocked rel (and drop href) before Node.prototype.appendChild/
      // insertBefore hand it - or any of its descendants - to the document,
      // and again if page script sets .rel/.setAttribute("rel", …) on an
      // element already in the tree. This is a stopgap, not a substitute for
      // sandbox-level egress control: it's still routable-around via Shadow
      // DOM or other insertion primitives this doesn't patch.
      function hasBlockedLinkRel(relValue) {
        return String(relValue || "")
          .toLowerCase()
          .split(/\\s+/)
          .some((token) => token === "preconnect" || token === "dns-prefetch");
      }
      function neutralizeSpeculativeLinkElement(el) {
        if (!el || el.tagName !== "LINK" || !hasBlockedLinkRel(el.getAttribute("rel"))) {
          return false;
        }
        el.setAttribute("rel", "");
        el.removeAttribute("href");
        return true;
      }
      function neutralizeTree(node) {
        if (!node || node.nodeType !== 1) return;
        neutralizeSpeculativeLinkElement(node);
        if (typeof node.querySelectorAll === "function") {
          node.querySelectorAll("link[rel]").forEach(neutralizeSpeculativeLinkElement);
        }
      }
      for (const method of ["appendChild", "insertBefore"]) {
        try {
          const original = Node.prototype[method];
          Node.prototype[method] = function (...methodArgs) {
            neutralizeTree(methodArgs[0]);
            return original.apply(this, methodArgs);
          };
        } catch (err) {
          console.error(diagToken + ": failed to patch Node.prototype." + method + ": " + (err && err.message ? err.message : String(err)));
        }
      }
      try {
        const relDescriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, "rel");
        if (relDescriptor && relDescriptor.set) {
          Object.defineProperty(HTMLLinkElement.prototype, "rel", {
            configurable: relDescriptor.configurable,
            enumerable: relDescriptor.enumerable,
            get: relDescriptor.get,
            set(value) {
              relDescriptor.set.call(this, hasBlockedLinkRel(value) ? "" : value);
            },
          });
        }
      } catch (err) {
        console.error(diagToken + ": failed to patch HTMLLinkElement.prototype.rel: " + (err && err.message ? err.message : String(err)));
      }
      try {
        const originalSetAttribute = Element.prototype.setAttribute;
        Element.prototype.setAttribute = function (name, value) {
          if (this.tagName === "LINK" && String(name).toLowerCase() === "rel" && hasBlockedLinkRel(value)) {
            return originalSetAttribute.call(this, name, "");
          }
          return originalSetAttribute.call(this, name, value);
        };
      } catch (err) {
        console.error(diagToken + ": failed to patch Element.prototype.setAttribute: " + (err && err.message ? err.message : String(err)));
      }

      // THI-80 Finding 1: stripSpeculativeLinkTags (applied to the raw HTTP
      // response body in allowRequest) and the appendChild/insertBefore/rel/
      // setAttribute patches above only ever see a <link> element built via
      // document.createElement plus a JS-level DOM-API mutation. None of
      // those fire when a page instead builds the same element through the
      // browser's native HTML-fragment parser: innerHTML/outerHTML
      // assignment, insertAdjacentHTML, and document.write/writeln all
      // construct and insert elements without ever calling
      // appendChild/insertBefore, and the rel attribute is already present
      // at parse time so setAttribute/the rel setter never fire either.
      // LinkLoader still honors the element regardless of insertion method,
      // so this was a full bypass - arguably the more common way real page
      // JS (and injection payloads) build markup than createElement +
      // appendChild. Closed by running every HTML string headed for the
      // parser through the same strip-and-comment-out transform
      // stripSpeculativeLinkTags already applies to the literal response
      // body, before handing it to the native setter/method. This is a
      // third hand-written copy of that regex (see stripSpeculativeLinkTags'
      // module-level comment for why a shared import isn't possible across
      // this boundary) because this one has to live inside the
      // addInitScript closure, not the script's Node-side top level.
      // THI-81 follow-up (found while fixing THI-81's two reported findings,
      // not itself reported by that review): this whole addInitScript
      // callback is plain text inside BROWSER_DRIVER_SCRIPT's outer template
      // literal, not real JS re-parsed by this file's own compiler - it only
      // becomes executable once written out to the sandbox's .mjs file - so
      // every backslash below goes through the SAME string-escape cooking as
      // the top-level stripSpeculativeLinkTags mirror above and must be
      // doubled to survive as a literal backslash in the shipped text. The
      // two regexes here previously used single backslashes (\b, \s): \b is
      // a *defined* string escape (backspace, U+0008) so it silently cooked
      // into an actual backspace byte instead of surviving as "\" + "b", and
      // \s isn't a defined string escape at all so the backslash was
      // silently dropped, leaving a bare "s". The tag matcher below was
      // therefore requiring a literal backspace character right after
      // "link", which never occurs in real HTML - making this entire
      // DOM-injection guard (innerHTML/outerHTML/insertAdjacentHTML/
      // document.write/writeln, all below) a silent no-op for every real
      // input, never caught by the existing tests because they only assert
      // BROWSER_DRIVER_SCRIPT.toContain(...) on literal source substrings or
      // run node --check (syntax validity, not behavior) - see the
      // extraction-and-execute tests added alongside this fix in
      // workerTools.test.ts, which run this exact shipped text and would
      // have caught it immediately.
      //
      // THI-81 Finding 2: also switched to the same quote-aware tag matcher
      // and attribute-level rel scan as the top-level mirror, for the same
      // reason (a literal ">" inside a quoted attribute value used to end
      // the tag match early, and a decoy attribute whose value contained the
      // text "rel=" could hide a later real one from a single first-match
      // regex).
      function stripSpeculativeLinkMarkup(html) {
        return String(html == null ? "" : html).replace(/<link\\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi, (tag) => {
          const attrPattern = /([a-zA-Z][-a-zA-Z0-9]*)\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)/g;
          let attrMatch;
          while ((attrMatch = attrPattern.exec(tag))) {
            if (attrMatch[1].toLowerCase() !== "rel") continue;
            if (hasBlockedLinkRel(attrMatch[2].replace(/^["']|["']$/g, ""))) {
              return "<!-- thismade: stripped speculative link -->";
            }
          }
          return tag;
        });
      }
      for (const prop of ["innerHTML", "outerHTML"]) {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, prop);
          if (descriptor && descriptor.set) {
            Object.defineProperty(Element.prototype, prop, {
              configurable: descriptor.configurable,
              enumerable: descriptor.enumerable,
              get: descriptor.get,
              set(value) {
                descriptor.set.call(this, stripSpeculativeLinkMarkup(value));
              },
            });
          }
        } catch (err) {
          console.error(diagToken + ": failed to patch Element.prototype." + prop + ": " + (err && err.message ? err.message : String(err)));
        }
      }
      try {
        const originalInsertAdjacentHTML = Element.prototype.insertAdjacentHTML;
        Element.prototype.insertAdjacentHTML = function (position, text) {
          return originalInsertAdjacentHTML.call(this, position, stripSpeculativeLinkMarkup(text));
        };
      } catch (err) {
        console.error(diagToken + ": failed to patch Element.prototype.insertAdjacentHTML: " + (err && err.message ? err.message : String(err)));
      }
      for (const method of ["write", "writeln"]) {
        try {
          const original = Document.prototype[method];
          // THI-81 Finding 1: document.write/writeln concatenate every
          // argument into one string before the HTML parser ever sees it
          // (per spec). Sanitizing each argument independently - the
          // previous per-argument .map() sanitize call - let a page
          // split a <link rel=preconnect> tag across the call boundary
          // (e.g. write('<link rel="preconnect" href="...">'.slice(0, -1),
          // ">")) so no single argument ever contained a complete tag for
          // the regex to match, then the native concatenation reassembled
          // the unstripped tag anyway. Joining first, matching the native
          // concatenation step, then sanitizing once closes that.
          Document.prototype[method] = function (...methodArgs) {
            return original.call(this, stripSpeculativeLinkMarkup(methodArgs.map(String).join("")));
          };
        } catch (err) {
          console.error(diagToken + ": failed to patch Document.prototype." + method + ": " + (err && err.message ? err.message : String(err)));
        }
      }
    }, DIAG_TOKEN);
    const page = await context.newPage();
    // THI-79: addInitScript runs in the page's own JS realm, so its
    // console.error calls above never reach this Node process's
    // stdout/stderr on their own - relay them into the diagnostics array.
    // THI-80 Finding 2: this used to match on the static literal
    // "thismade:", which any navigated page could forge itself by calling
    // console.error with that exact prefix - matching on the unpredictable
    // per-invocation DIAG_TOKEN instead (known only to this Node process and
    // the addInitScript closure it was passed into, never exposed on
    // window) means a page has no way to counterfeit a "trusted" diagnostic.
    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "error" && text.indexOf(DIAG_TOKEN) === 0) {
        diagnostics.push("page console: " + text);
      }
    });
    let redirectTarget = null;
    await context.route("**/*", async (route) => {
      const reqUrl = route.request().url();
      let reqHostname;
      try {
        reqHostname = parseHostname(reqUrl);
      } catch {
        await route.abort("blockedbyclient");
        return;
      }
      if (isIP(reqHostname)) {
        if (isBlockedIpAddress(reqHostname)) {
          await route.abort("blockedbyclient");
          return;
        }
        await allowRequest(route);
        return;
      }
      const pinned = currentRules.some((r) => r.startsWith("MAP " + reqHostname + " "));
      if (pinned) {
        await allowRequest(route);
        return;
      }
      // A hostname we haven't pinned yet - most commonly a top-level redirect
      // target. Don't let Chromium resolve it on its own; abort this request
      // and let the outer loop relaunch with this host pinned before
      // retrying. Only a *main-frame* navigation qualifies as a redirect to
      // chase: isNavigationRequest() is also true for iframe navigations,
      // and treating one of those as "the" redirect target would hijack the
      // whole page's next navigation attempt to wherever an iframe (or a
      // page-injected one) was pointed - an unpinned iframe/subresource load
      // is simply blocked instead, same as any other unpinned subresource.
      if (route.request().isNavigationRequest() && route.request().frame() === page.mainFrame() && redirectTarget === null) {
        redirectTarget = reqUrl;
      }
      await route.abort("blockedbyclient");
    });

    let navError = null;
    try {
      await page.goto(pendingUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    } catch (err) {
      navError = err;
    }

    if (redirectTarget) {
      await browser.close();
      pendingUrl = redirectTarget;
      continue;
    }
    if (navError) {
      await browser.close();
      throw navError;
    }
    return { browser, page, finalUrl: page.url(), rules: currentRules };
  }
  throw new Error("navigate_blocked:too_many_redirect_hops:" + targetUrl);
}

const state = loadState();
let result = { ok: true };
let browser = null;
try {
  let page;
  if (action === "navigate") {
    const nav = await navigateWithPinning(args.url, state.hostResolverRules);
    browser = nav.browser;
    page = nav.page;
    state.hostResolverRules = nav.rules;
    state.url = nav.finalUrl;
    result.url = state.url;
  } else {
    if (!state.url) throw new Error("no_active_page:" + action);
    const restored = await navigateWithPinning(state.url, state.hostResolverRules);
    browser = restored.browser;
    page = restored.page;
    state.hostResolverRules = restored.rules;
    if (action === "click") {
      await page.click(args.selector, { timeout: 10000 });
      state.url = page.url();
      result.url = state.url;
    } else if (action === "read_page_text") {
      result.text = await page.innerText("body");
    } else {
      throw new Error("unknown_action:" + action);
    }
  }
  saveState(state);
} catch (err) {
  result = { ok: false, error: String(err && err.message ? err.message : err) };
} finally {
  if (browser) await browser.close();
}
// THI-79: attach whatever allowRequest/the WebRTC+link-guard lockdown
// reported, on both the success and failure path - a fallback that still
// let the navigation succeed is exactly the case that must not go silent.
if (diagnostics.length) result.diagnostics = diagnostics;
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
  let parsed: { ok: boolean; text?: string; url?: string; error?: string; diagnostics?: string[] };
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return { ok: false, resultSummary: truncate(`unparseable_driver_output: ${result.stdout}`) };
  }
  // THI-79: a fallback (e.g. allowRequest falling back to an unstripped
  // continue(), or the WebRTC/link lockdown silently failing to apply) can
  // fire on a navigation that otherwise still reports ok: true - fold any
  // driver diagnostics into resultSummary on both branches below so that
  // case surfaces in the tool_result event instead of vanishing.
  const diagnosticsSuffix = parsed.diagnostics?.length
    ? `\ndiagnostics:\n${parsed.diagnostics.join("\n")}`
    : "";
  if (!parsed.ok) {
    return { ok: false, resultSummary: truncate((parsed.error ?? "browser_action_failed") + diagnosticsSuffix) };
  }
  const summary = parsed.text ? parsed.text : (parsed.url ?? "ok");
  return { ok: true, resultSummary: truncate(summary + diagnosticsSuffix) };
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
