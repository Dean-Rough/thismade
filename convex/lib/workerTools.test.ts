import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  executeTool,
  isDestructiveToolCall,
  planNavigationHop,
  stripSpeculativeLinkTags,
  BROWSER_DRIVER_SCRIPT,
} from "./workerTools";
import type { ToolExecutionContext } from "./workerTools";
import type { SandboxCommandResult, SandboxHandle } from "./sandboxProvider";

// A minimal SandboxHandle whose runCommand records every invocation. If
// navigate() ever reaches the sandbox for a URL that should have been
// blocked, `commands` will be non-empty and the test fails on that instead
// of (or in addition to) the thrown error - this is what makes these tests
// actually prove the sandbox never sees the disallowed navigation, not just
// that *a* rejection happened.
class RecordingSandbox implements SandboxHandle {
  commands: string[] = [];

  async runCommand(command: string): Promise<SandboxCommandResult> {
    this.commands.push(command);
    return { stdout: "", stderr: "", exitCode: 0 };
  }
  async writeFile(): Promise<void> {}
  async readFile(): Promise<string> {
    throw new Error("not_implemented");
  }
  async close(): Promise<void> {}
}

async function attemptNavigate(url: string, ctx: Partial<ToolExecutionContext> = {}) {
  const sandbox = new RecordingSandbox();
  let error: unknown;
  try {
    await executeTool("browser", "navigate", { url }, { sandbox, ...ctx });
  } catch (err) {
    error = err;
  }
  return { sandbox, error };
}

describe("executeTool navigate URL validation (THI-71)", () => {
  it("rejects a file:// URL before it reaches the sandbox", async () => {
    const { sandbox, error } = await attemptNavigate("file:///etc/passwd");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:disallowed_scheme:file:");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects a javascript: URL before it reaches the sandbox", async () => {
    const { sandbox, error } = await attemptNavigate("javascript:alert(document.cookie)");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:disallowed_scheme:javascript:");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects a literal loopback IP host before it reaches the sandbox", async () => {
    const { sandbox, error } = await attemptNavigate("http://127.0.0.1/");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:private_address:127.0.0.1");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects the cloud-metadata link-local address", async () => {
    const { sandbox, error } = await attemptNavigate("http://169.254.169.254/latest/meta-data/");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:private_address:169.254.169.254");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects an RFC1918 private IP host", async () => {
    const { sandbox, error } = await attemptNavigate("https://10.0.0.5/internal-admin");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:private_address:10.0.0.5");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects an IPv6 loopback host", async () => {
    const { sandbox, error } = await attemptNavigate("http://[::1]/");
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:private_address:::1");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("rejects a hostname whose DNS resolution lands on a private IP (DNS-rebinding shape)", async () => {
    const { sandbox, error } = await attemptNavigate("https://attacker-controlled.example/", {
      resolveHostnameAddresses: async () => ["10.1.2.3"],
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:private_address:attacker-controlled.example");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("fails closed when DNS resolution errors instead of allowing the navigation through", async () => {
    const { sandbox, error } = await attemptNavigate("https://does-not-resolve.example/", {
      resolveHostnameAddresses: async () => {
        throw new Error("ENOTFOUND");
      },
    });
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("navigate_blocked:dns_resolution_failed:does-not-resolve.example");
    expect(sandbox.commands).toHaveLength(0);
  });

  it("allows a normal public https URL whose hostname resolves to a public IP", async () => {
    const { sandbox, error } = await attemptNavigate("https://example.com/", {
      resolveHostnameAddresses: async () => ["93.184.216.34"],
    });
    expect(error).toBeUndefined();
    expect(sandbox.commands.length).toBeGreaterThan(0);
  });
});

describe("isDestructiveToolCall (THI-66)", () => {
  it("flags the coding worker's run_shell as destructive", () => {
    expect(isDestructiveToolCall("coding", "run_shell")).toBe(true);
  });

  it("does not flag coding's other tools — they stay inside the sandbox workspace", () => {
    expect(isDestructiveToolCall("coding", "read_file")).toBe(false);
    expect(isDestructiveToolCall("coding", "write_file")).toBe(false);
    expect(isDestructiveToolCall("coding", "list_directory")).toBe(false);
  });

  it("does not flag any browser or marketing tool — neither workerType has a destructive tool registered yet", () => {
    expect(isDestructiveToolCall("browser", "navigate")).toBe(false);
    expect(isDestructiveToolCall("browser", "click")).toBe(false);
    expect(isDestructiveToolCall("browser", "read_page_text")).toBe(false);
    expect(isDestructiveToolCall("marketing", "read_context_file")).toBe(false);
    expect(isDestructiveToolCall("marketing", "submit_draft")).toBe(false);
  });

  it("does not throw or misclassify an unregistered tool name — callers must check assertToolAllowed separately", () => {
    expect(isDestructiveToolCall("marketing", "run_shell")).toBe(false);
  });
});

// THI-72: planNavigationHop is the tested source of truth for the pinning
// decision the sandboxed browser driver's hand-written mirror (pinHostname
// in BROWSER_DRIVER_SCRIPT) has to reproduce - these tests exercise the
// actual algorithm directly, since the driver script itself only runs
// inside a real E2B sandbox this environment doesn't have credentials for.
describe("planNavigationHop (THI-72 DNS-rebinding pin)", () => {
  it("rejects a disallowed scheme before ever resolving anything", async () => {
    const resolveHostname = vi.fn();
    await expect(planNavigationHop("file:///etc/passwd", new Set(), resolveHostname)).rejects.toThrow(
      "navigate_blocked:disallowed_scheme:file:",
    );
    expect(resolveHostname).not.toHaveBeenCalled();
  });

  it("rejects a blocked literal IP with no rule to pin", async () => {
    await expect(planNavigationHop("http://169.254.169.254/", new Set(), vi.fn())).rejects.toThrow(
      "navigate_blocked:private_address:169.254.169.254",
    );
  });

  it("returns no rule for an allowed literal IP - nothing to pin, Chromium connects directly", async () => {
    const plan = await planNavigationHop("http://93.184.216.34/", new Set(), vi.fn());
    expect(plan).toEqual({ hostname: "93.184.216.34", newHostResolverRule: null });
  });

  it("resolves an unpinned hostname and returns a MAP rule joining every validated address", async () => {
    const resolveHostname = vi.fn().mockResolvedValue(["93.184.216.34", "93.184.216.35"]);
    const plan = await planNavigationHop("https://example.com/", new Set(), resolveHostname);
    expect(resolveHostname).toHaveBeenCalledWith("example.com");
    expect(plan).toEqual({
      hostname: "example.com",
      newHostResolverRule: "MAP example.com 93.184.216.34,93.184.216.35",
    });
  });

  it("rejects a hostname if any resolved address is private, even if others are public", async () => {
    const resolveHostname = vi.fn().mockResolvedValue(["93.184.216.34", "10.0.0.5"]);
    await expect(planNavigationHop("https://mixed.example/", new Set(), resolveHostname)).rejects.toThrow(
      "navigate_blocked:private_address:mixed.example",
    );
  });

  it("does not re-resolve an already-pinned hostname (this is what closes the rebinding window on repeat hops)", async () => {
    const resolveHostname = vi.fn().mockResolvedValue(["10.0.0.5"]); // would fail if it were called
    const plan = await planNavigationHop("https://already-pinned.example/", new Set(["already-pinned.example"]), resolveHostname);
    expect(resolveHostname).not.toHaveBeenCalled();
    expect(plan).toEqual({ hostname: "already-pinned.example", newHostResolverRule: null });
  });

  it("fails closed when DNS resolution throws", async () => {
    const resolveHostname = vi.fn().mockRejectedValue(new Error("ENOTFOUND"));
    await expect(planNavigationHop("https://does-not-resolve.example/", new Set(), resolveHostname)).rejects.toThrow(
      "navigate_blocked:dns_resolution_failed:does-not-resolve.example",
    );
  });
});

// This environment has no E2B credentials, so BROWSER_DRIVER_SCRIPT's actual
// Playwright/host-resolver-rules behavior can't be exercised end-to-end here
// - that remains unverified until it runs against a real sandbox. This test
// is a narrower, honest claim: the exact text shipped to the sandbox is at
// least syntactically valid ESM, so a template-literal escaping slip (e.g. a
// stray backslash in the regexes mirrored from isBlockedIpv6) would fail CI
// instead of only surfacing as a runtime crash inside a live worker task.
describe("BROWSER_DRIVER_SCRIPT (THI-72)", () => {
  it("is syntactically valid ES module source", () => {
    const dir = mkdtempSync(join(tmpdir(), "thismade-driver-script-check-"));
    const scriptPath = join(dir, "driver.mjs");
    try {
      writeFileSync(scriptPath, BROWSER_DRIVER_SCRIPT);
      expect(() => execFileSync(process.execPath, ["--check", scriptPath], { stdio: "pipe" })).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wires up host-resolver-rules pinning and a bounded redirect-hop loop", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("--host-resolver-rules=");
    expect(BROWSER_DRIVER_SCRIPT).toContain("context.route(");
    expect(BROWSER_DRIVER_SCRIPT).toContain("isNavigationRequest");
    expect(BROWSER_DRIVER_SCRIPT).toContain("MAX_REDIRECT_HOPS");
  });

  // THI-72 follow-up: page.route() never sees WebSocket connections or
  // window.open() popups, so a scraped/prompt-injected page's own JS could
  // reach an internal/metadata host through either primitive without ever
  // touching the pinning/validation logic above. Asserting the driver source
  // wires up the context-level guards is the same "catch a future regression
  // in the shipped text" pattern as the pinning assertion above.
  it("closes popups, blocks WebSocket connections, and disables service workers", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("context.on(\"page\"");
    expect(BROWSER_DRIVER_SCRIPT).toContain("routeWebSocket(");
    expect(BROWSER_DRIVER_SCRIPT).toContain("serviceWorkers: \"block\"");
  });

  // THI-75: WebRTC ICE gathering and dns-prefetch/preconnect sit outside the
  // request-interception model entirely (no HTTP request for context.route()
  // to ever see), so unlike the checks above these can't be proven by
  // exercising request handling - the same "assert the shipped text wires up
  // the guard" pattern is the best available check without a live sandbox.
  it("disables WebRTC via an init script and a Chromium launch flag", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("addInitScript(");
    expect(BROWSER_DRIVER_SCRIPT).toContain("RTCPeerConnection");
    expect(BROWSER_DRIVER_SCRIPT).toContain("--force-webrtc-ip-handling-policy=disable_non_proxied_udp");
  });

  it("disables dns-prefetch via a Chromium launch flag and strips speculative <link> tags from every document response", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("--dns-prefetch-disable");
    expect(BROWSER_DRIVER_SCRIPT).toContain("stripSpeculativeLinkTags");
    expect(BROWSER_DRIVER_SCRIPT).toContain("resourceType() === \"document\"");
  });

  // The route.fetch()-based rewrite must never let a redirect response
  // bypass the per-hop DNS-pinning loop above by following it internally -
  // this pins down that the driver text actually guards for that (see
  // allowRequest's maxRedirects: 0 comment), not just that a rewrite exists.
  it("does not let the document-rewrite path swallow a redirect response", () => {
    expect(BROWSER_DRIVER_SCRIPT).toContain("maxRedirects: 0");
    expect(BROWSER_DRIVER_SCRIPT).toContain("status >= 300 && status < 400");
  });
});

// THI-75: stripSpeculativeLinkTags is the tested source of truth the driver
// script's hand-written mirror (same function, inlined as JS text inside
// BROWSER_DRIVER_SCRIPT) has to reproduce - same "test the TS copy directly"
// pattern as planNavigationHop/pinHostname above.
describe("stripSpeculativeLinkTags (THI-75)", () => {
  it("strips a preconnect link tag", () => {
    const html = '<head><link rel="preconnect" href="https://evil.example"></head>';
    expect(stripSpeculativeLinkTags(html)).not.toContain("evil.example");
    expect(stripSpeculativeLinkTags(html)).not.toContain("<link");
  });

  it("strips a dns-prefetch link tag", () => {
    const html = '<link rel="dns-prefetch" href="//evil.example">';
    expect(stripSpeculativeLinkTags(html)).not.toContain("evil.example");
  });

  it("strips a preconnect link tag with single-quoted attributes", () => {
    const html = "<link rel='preconnect' href='https://evil.example'>";
    expect(stripSpeculativeLinkTags(html)).not.toContain("evil.example");
  });

  it("strips a link tag whose rel contains preconnect alongside other tokens", () => {
    const html = '<link rel="noopener preconnect" href="https://evil.example">';
    expect(stripSpeculativeLinkTags(html)).not.toContain("evil.example");
  });

  it("leaves an unrelated link tag (e.g. stylesheet) untouched", () => {
    const html = '<link rel="stylesheet" href="/app.css">';
    expect(stripSpeculativeLinkTags(html)).toBe(html);
  });

  it("leaves a plain prefetch link (not dns-prefetch) untouched", () => {
    const html = '<link rel="prefetch" href="/next-page.html">';
    expect(stripSpeculativeLinkTags(html)).toBe(html);
  });

  it("leaves the rest of the document intact", () => {
    const html = '<html><head><link rel="preconnect" href="https://evil.example"><title>ok</title></head><body>hi</body></html>';
    const stripped = stripSpeculativeLinkTags(html);
    expect(stripped).toContain("<title>ok</title>");
    expect(stripped).toContain("<body>hi</body>");
  });
});
