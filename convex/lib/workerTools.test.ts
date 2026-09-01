import { describe, expect, it } from "vitest";
import { executeTool } from "./workerTools";
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
