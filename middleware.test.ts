import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { middleware } from "./middleware";

const SECRET = "correct-secret";

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

  it("returns 401 with no cookie and no key", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest("https://example.com/dashboard");
    const response = middleware(request);
    expect(response.status).toBe(401);
  });

  it("returns 401 for a wrong cookie value", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest("https://example.com/dashboard", {
      headers: { cookie: "dashboard_access=wrong-secret" },
    });
    const response = middleware(request);
    expect(response.status).toBe(401);
  });

  it("passes through with the right cookie value", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest("https://example.com/dashboard", {
      headers: { cookie: `dashboard_access=${SECRET}` },
    });
    const response = middleware(request);
    expect(response.status).toBe(200);
  });

  it("redirects, strips the key, and sets the cookie on a valid ?key=", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest(`https://example.com/dashboard?key=${SECRET}`);
    const response = middleware(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.com/dashboard");
    const setCookie = response.cookies.get("dashboard_access");
    expect(setCookie?.value).toBe(SECRET);
    expect(setCookie?.httpOnly).toBe(true);
  });

  it("returns 401 for a wrong ?key= value and does not set a cookie", () => {
    process.env.DASHBOARD_ACCESS_SECRET = SECRET;
    const request = new NextRequest("https://example.com/dashboard?key=wrong-secret");
    const response = middleware(request);
    expect(response.status).toBe(401);
    expect(response.cookies.get("dashboard_access")).toBeUndefined();
  });
});
