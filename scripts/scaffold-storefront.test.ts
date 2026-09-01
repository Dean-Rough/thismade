import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import { run } from "./scaffold-storefront.mjs";

describe("scaffold-storefront run()", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    vi.mocked(execFileSync).mockClear();
  });

  it("redacts the argument at redactArgAt instead of logging it in cleartext", () => {
    const secret = "super-secret-convex-service-secret-value";
    run(
      "npx",
      ["convex", "env", "set", "CONVEX_SERVICE_SECRET", secret],
      "/tmp/some-out-dir",
      { PATH: "/usr/bin" },
      { redactArgAt: 4 },
    );

    const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).not.toContain(secret);
    expect(logged).toContain("<redacted>");

    // The real secret must still reach the subprocess unredacted.
    expect(execFileSync).toHaveBeenCalledWith(
      "npx",
      ["convex", "env", "set", "CONVEX_SERVICE_SECRET", secret],
      expect.objectContaining({ cwd: "/tmp/some-out-dir" }),
    );
  });

  it("logs args in full when no redactArgAt is given (unaffected call sites)", () => {
    run("npm", ["install"], "/tmp/some-out-dir", { PATH: "/usr/bin" });

    const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("npm install");
  });
});
