import { describe, expect, it } from "vitest";
import { signAdminToken, verifyAdminToken } from "./adminAuth";

const SECRET = "test-secret-do-not-use-in-prod";
const SLUG = "acme-test";

describe("admin JWT gate", () => {
  it("accepts a freshly signed token for the expected business", async () => {
    const token = await signAdminToken({ businessSlug: SLUG }, SECRET);
    const claims = await verifyAdminToken(token, SECRET, SLUG);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe(SLUG);
  });

  it("rejects an unsigned/garbage token", async () => {
    await expect(verifyAdminToken("not-a-jwt", SECRET, SLUG)).resolves.toBeNull();
    await expect(verifyAdminToken("a.b.c", SECRET, SLUG)).resolves.toBeNull();
    await expect(verifyAdminToken("", SECRET, SLUG)).resolves.toBeNull();
  });

  it("rejects a token signed with the wrong secret", async () => {
    const token = await signAdminToken({ businessSlug: SLUG }, "a-different-secret");
    await expect(verifyAdminToken(token, SECRET, SLUG)).resolves.toBeNull();
  });

  it("rejects a tampered payload even if the original signature is reused", async () => {
    const token = await signAdminToken({ businessSlug: SLUG }, SECRET);
    const [header, payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const tampered = { ...decoded, sub: "some-other-business" };
    const tamperedPayload = Buffer.from(JSON.stringify(tampered)).toString("base64url");
    const tamperedToken = `${header}.${tamperedPayload}.${signature}`;
    await expect(verifyAdminToken(tamperedToken, SECRET, SLUG)).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signAdminToken({ businessSlug: SLUG, ttlSeconds: -1 }, SECRET);
    await expect(verifyAdminToken(token, SECRET, SLUG)).resolves.toBeNull();
  });

  it("rejects a token minted for a different business slug", async () => {
    const token = await signAdminToken({ businessSlug: "other-business" }, SECRET);
    await expect(verifyAdminToken(token, SECRET, SLUG)).resolves.toBeNull();
  });
});
