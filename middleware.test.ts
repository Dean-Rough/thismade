import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { config, middleware } from "./middleware";

const SECRET = "correct-secret-that-is-at-least-32-chars-long";
const COOKIE = "__Host-dashboard_access";

describe("dashboard middleware config (THI-90)", () => {
  it("pins the exact matcher — a change here is a security-relevant change", () => {
    // Regression pin: config.matcher is the actual boundary this middleware
    // enforces. Directly unit-testing middleware() cannot catch a matcher
    // typo (e.g. :path* -> :path+) since every test below calls middleware()
    // itself, bypassing Next's matcher compilation entirely (found in
    // review, PR #19).
    expect(config.matcher).toEqual(["/dashboard/:path*", "/api/dashboard/:path*"]);
  });
});

describe("dashboard middleware (THI-90)", () => {
  afterEach(() => {
    delete process.env.DASHBOARD_ACCESS_SECRET;
  });

  it("fails closed with 503 when the secret is not configured", () => {
    delete process.env.DASHBOARD_ACCESS_SECRET;
    const request = new NextRequest("https://example.com/dashboard");
    const response = middleware(request);
    expect(response.status).toBe(503);
  });

  it("fails closed with 503 when the secret is below the entropy floor", () => {
    process.env.DASHBOARD_ACCESS_SECRET = "short";
    const request = new NextRequest(`https://example.com/dashboard?key=short`);
    const response = middleware(request);
    expect(response.status).toBe(503);
  });

  it("returns 401 with no cookie and no key", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest("https://example.com/dashboard");
    const response = middleware(request);
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 401 for a wrong cookie value", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest("https://example.com/dashboard", {
      headers: { cookie: `${COOKIE}=wrong-secret` },
    });
    const response = middleware(request);
    expect(response.status).toBe(401);
  });

  it("resolves duplicate cookies to the last value — still rejects if that's wrong", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest("https://example.com/dashboard", {
      headers: { cookie: `${COOKIE}=${SECRET}; ${COOKIE}=wrong-secret` },
    });
    const response = middleware(request);
    expect(response.status).toBe(401);
  });

  it("passes through with the right cookie value", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest("https://example.com/dashboard", {
      headers: { cookie: `${COOKIE}=${SECRET}` },
    });
    const response = middleware(request);
    expect(response.status).toBe(200);
  });

  it("redirects, strips the key, and sets the __Host- cookie on a valid ?key=", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest(`https://example.com/dashboard?key=${SECRET}`);
    const response = middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/dashboard");
    const setCookie = response.cookies.get(COOKIE);
    expect(setCookie?.value).toBe(SECRET);
    expect(setCookie?.httpOnly).toBe(true);
    expect(setCookie?.secure).toBe(true);
    expect(setCookie?.sameSite).toBe("lax");
  });

  it("returns 401 for a wrong ?key= value and does not set a cookie", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest("https://example.com/dashboard?key=wrong-secret");
    const response = middleware(request);
    expect(response.status).toBe(401);
    expect(response.cookies.get(COOKIE)).toBeUndefined();
  });
});
