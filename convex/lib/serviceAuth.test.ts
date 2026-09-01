import { afterEach, describe, expect, it } from "vitest";
import { assertServiceSecret } from "./serviceAuth";

// THI-63: assertServiceSecret moved from `!==` to a constant-time compare.
// These tests pin the same accept/reject behavior as before the change.
describe("assertServiceSecret", () => {
  afterEach(() => {
    delete process.env.CONVEX_SERVICE_SECRET;
  });

  it("accepts the right secret", () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    expect(() => assertServiceSecret("correct-secret")).not.toThrow();
  });

  it("rejects the wrong secret", () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    expect(() => assertServiceSecret("wrong-secret")).toThrow("unauthorized");
  });

  it("rejects a secret of a different length than expected", () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    expect(() => assertServiceSecret("short")).toThrow("unauthorized");
    expect(() => assertServiceSecret("correct-secret-but-longer")).toThrow("unauthorized");
  });

  it("rejects an empty secret", () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    expect(() => assertServiceSecret("")).toThrow("unauthorized");
  });

  it("rejects when CONVEX_SERVICE_SECRET is not configured at all", () => {
    delete process.env.CONVEX_SERVICE_SECRET;
    expect(() => assertServiceSecret("anything")).toThrow("service_secret_not_configured");
  });
});
