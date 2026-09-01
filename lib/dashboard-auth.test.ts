import { describe, expect, it } from "vitest";
import { verifyBasicAuthHeader } from "./dashboard-auth";

function basicHeader(user: string, password: string): string {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

describe("verifyBasicAuthHeader", () => {
  it("accepts the correct user/password", () => {
    expect(verifyBasicAuthHeader(basicHeader("owner", "s3cret"), "owner", "s3cret")).toBe(true);
  });

  it("rejects a wrong password", () => {
    expect(verifyBasicAuthHeader(basicHeader("owner", "wrong"), "owner", "s3cret")).toBe(false);
  });

  it("rejects a wrong user", () => {
    expect(verifyBasicAuthHeader(basicHeader("attacker", "s3cret"), "owner", "s3cret")).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyBasicAuthHeader(null, "owner", "s3cret")).toBe(false);
  });

  it("rejects a non-Basic scheme", () => {
    expect(verifyBasicAuthHeader("Bearer abc123", "owner", "s3cret")).toBe(false);
  });

  it("rejects malformed base64", () => {
    expect(verifyBasicAuthHeader("Basic not-valid-base64!!!", "owner", "s3cret")).toBe(false);
  });

  it("rejects a credential with no colon separator", () => {
    expect(verifyBasicAuthHeader(`Basic ${btoa("no-separator")}`, "owner", "s3cret")).toBe(false);
  });

  it("handles a password containing a colon", () => {
    expect(verifyBasicAuthHeader(basicHeader("owner", "pass:word"), "owner", "pass:word")).toBe(true);
  });
});
