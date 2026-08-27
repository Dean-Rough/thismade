import { describe, expect, it } from "vitest";
import { config } from "./middleware";

function matchesMatcher(pathname: string) {
  // Next.js matches these patterns against the full pathname, not a
  // substring — anchor accordingly so the lookahead can't be satisfied by
  // skipping ahead to a later "/" in the path (e.g. "/v1/business" matching
  // by starting the pattern's leading "/" at the second slash instead).
  return config.matcher.some((pattern) => new RegExp(`^${pattern}$`).test(pathname));
}

describe("middleware matcher", () => {
  it("excludes /v1/* commerce API routes from Clerk entirely", () => {
    expect(matchesMatcher("/v1/business")).toBe(false);
    expect(matchesMatcher("/v1/products")).toBe(false);
    expect(matchesMatcher("/v1/orders/abc123/refund")).toBe(false);
  });

  it("excludes /api/* (e.g. the Stripe webhook) from Clerk entirely", () => {
    expect(matchesMatcher("/api/webhooks/stripe")).toBe(false);
  });

  it("still routes dashboard/auth pages through Clerk", () => {
    expect(matchesMatcher("/")).toBe(true);
    expect(matchesMatcher("/sign-in")).toBe(true);
    expect(matchesMatcher("/dashboard")).toBe(true);
  });

  it("excludes static assets and _next", () => {
    expect(matchesMatcher("/_next/static/chunk.js")).toBe(false);
    expect(matchesMatcher("/logo.svg")).toBe(false);
  });
});
