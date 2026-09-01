import { afterEach, describe, expect, it } from "vitest";
import { assertServiceSecret } from "./serviceAuth";

// THI-61: assertServiceSecret moved from `!==` to a hashed, constant-time
// compare. These tests pin the same accept/reject behavior as before the
// change — see convex/fulfillmentEvents.test.ts for the end-to-end action
// coverage of this same gate.
describe("assertServiceSecret", () => {
  afterEach(() => {
    delete process.env.CONVEX_SERVICE_SECRET;
  });

  it("accepts the right secret", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    await expect(assertServiceSecret("correct-secret")).resolves.toBeUndefined();
  });

  it("rejects the wrong secret", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    await expect(assertServiceSecret("wrong-secret")).rejects.toThrow("unauthorized");
  });

  it("rejects a secret of a different length than expected", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    await expect(assertServiceSecret("short")).rejects.toThrow("unauthorized");
    await expect(assertServiceSecret("correct-secret-but-longer")).rejects.toThrow("unauthorized");
  });

  it("rejects an empty secret", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    await expect(assertServiceSecret("")).rejects.toThrow("unauthorized");
  });

  it("rejects when CONVEX_SERVICE_SECRET is not configured at all", async () => {
    delete process.env.CONVEX_SERVICE_SECRET;
    await expect(assertServiceSecret("anything")).rejects.toThrow("service_secret_not_configured");
  });
});
