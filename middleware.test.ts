import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";

import { config, middleware } from "./middleware";

const USER = "owner";
const PASSWORD = "correct-secret";

function requestWithAuth(url: string, user?: string, password?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (user !== undefined && password !== undefined) {
    headers.authorization = `Basic ${btoa(`${user}:${password}`)}`;
  }
  return new NextRequest(url, { headers });
}

describe("dashboard middleware config (THI-90)", () => {
  it("pins the exact matcher — a change here is a security-relevant change", () => {
    // Regression pin: config.matcher is the actual boundary this middleware
    // enforces. Directly unit-testing middleware() cannot catch a matcher
    // typo (e.g. :path* -> :path+) since every test below calls middleware()
    // itself, bypassing Next's matcher compilation entirely.
    expect(config.matcher).toEqual(["/dashboard/:path*", "/api/dashboard/:path*"]);
  });
});

describe("dashboard middleware (THI-17/THI-90)", () => {
  afterEach(() => {
    delete process.env.DASHBOARD_BASIC_AUTH_USER;
    delete process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
  });

  it("fails closed with 401 when neither credential is configured", () => {
    delete process.env.DASHBOARD_BASIC_AUTH_USER;
    delete process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
    const response = middleware(requestWithAuth("https://example.com/dashboard"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("fails closed with 401 when only the user is configured", () => {
    process.env.DASHBOARD_BASIC_AUTH_USER = USER;
    delete process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
    const response = middleware(requestWithAuth("https://example.com/dashboard", USER, PASSWORD));
    expect(response.status).toBe(401);
  });

  it("returns 401 with no Authorization header", () => {
    process.env.DASHBOARD_BASIC_AUTH_USER = USER;
    process.env.DASHBOARD_BASIC_AUTH_PASSWORD = PASSWORD;
    const response = middleware(requestWithAuth("https://example.com/dashboard"));
    expect(response.status).toBe(401);
  });

  it("returns 401 for wrong credentials", () => {
    process.env.DASHBOARD_BASIC_AUTH_USER = USER;
    process.env.DASHBOARD_BASIC_AUTH_PASSWORD = PASSWORD;
    const response = middleware(requestWithAuth("https://example.com/dashboard", USER, "wrong"));
    expect(response.status).toBe(401);
  });

  it("passes through with the right credentials", () => {
    process.env.DASHBOARD_BASIC_AUTH_USER = USER;
    process.env.DASHBOARD_BASIC_AUTH_PASSWORD = PASSWORD;
    const response = middleware(requestWithAuth("https://example.com/dashboard", USER, PASSWORD));
    expect(response.status).toBe(200);
  });

  it("passes through on the /api/dashboard/* prefix too", () => {
    process.env.DASHBOARD_BASIC_AUTH_USER = USER;
    process.env.DASHBOARD_BASIC_AUTH_PASSWORD = PASSWORD;
    const response = middleware(
      requestWithAuth("https://example.com/api/dashboard/timeline", USER, PASSWORD),
    );
    expect(response.status).toBe(200);
  });
});
