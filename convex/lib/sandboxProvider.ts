"use node";

// Design lens: sandbox-only execution. Every worker's code/tool execution
// happens inside E2B/container isolation, never directly against the host or
// this repo's own working tree. This file defines the provider interface so
// convex/lib/workerLoop.ts (the orchestration loop) can be unit-tested
// against a fake, and convex/workerRunner.ts (the real "use node" action)
// wires in the real E2B-backed implementation below.
//
// No E2B_API_KEY is provisioned in this environment as of THI-68 — see the
// THI-68 plan document. createSandboxProvider() below still throws a clear,
// catchable error rather than silently no-op'ing, so a deployed worker run
// fails loudly (logged as a typed `error` event + recordAttemptFailure)
// instead of hanging or pretending to succeed.

export interface SandboxCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxHandle {
  runCommand(command: string, opts?: { timeoutMs?: number }): Promise<SandboxCommandResult>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  close(): Promise<void>;
}

export interface SandboxProvider {
  create(opts: { label: string }): Promise<SandboxHandle>;
}

class E2bSandboxHandle implements SandboxHandle {
  // Typed as `any` deliberately: the `e2b` SDK's `Sandbox` type is only
  // available in the Node runtime this file is bundled into via
  // convex/workerRunner.ts's `"use node"` directive. Importing it as a type
  // here would be fine too, but keeping the exact SDK surface this class
  // touches small and explicit (four methods) is what actually keeps this
  // adapter swappable, not the import style.
  constructor(private readonly sandbox: any) {}

  async runCommand(command: string, opts?: { timeoutMs?: number }): Promise<SandboxCommandResult> {
    const result = await this.sandbox.commands.run(command, {
      timeoutMs: opts?.timeoutMs ?? 60_000,
    });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? (result.error ? 1 : 0),
    };
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sandbox.files.write(path, content);
  }

  async readFile(path: string): Promise<string> {
    return this.sandbox.files.read(path);
  }

  async close(): Promise<void> {
    await this.sandbox.kill();
  }
}

export class E2bSandboxProvider implements SandboxProvider {
  async create(opts: { label: string }): Promise<SandboxHandle> {
    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) {
      throw new Error("e2b_api_key_not_configured");
    }
    // Dynamic import: this module is imported from convex/lib/workerLoop.ts's
    // test file too (indirectly, via type-only usage) — deferring the actual
    // `e2b` package load to call time keeps `createSandboxProvider()` the
    // only code path that requires the dependency to be resolvable.
    const { Sandbox } = await import("e2b");
    const sandbox = await Sandbox.create({
      apiKey,
      metadata: { label: opts.label, source: "thismade-worker-runner" },
    });
    return new E2bSandboxHandle(sandbox);
  }
}

export function createSandboxProvider(): SandboxProvider {
  return new E2bSandboxProvider();
}
