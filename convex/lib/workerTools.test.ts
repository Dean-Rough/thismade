import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeTool, planNavigationHop, BROWSER_DRIVER_SCRIPT } from "./workerTools";
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
    expect(BROWSER_DRIVER_SCRIPT).toContain("page.route(");
    expect(BROWSER_DRIVER_SCRIPT).toContain("isNavigationRequest");
    expect(BROWSER_DRIVER_SCRIPT).toContain("MAX_REDIRECT_HOPS");
  });
});
