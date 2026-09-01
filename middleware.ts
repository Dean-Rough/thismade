import { NextRequest, NextResponse } from "next/server";

import { DASHBOARD_ACCESS_COOKIE, readDashboardSecret, timingSafeEqualString } from "@/lib/dashboardAuth";

// THI-90: interim gate for /dashboard* — there is no session/identity layer yet
// (Clerk was removed, see DECISIONS.md's Clerk-removal entry), and THI-17 wires
// real destructive Server Actions (tool-call approval, task close-out, owner
// chat) to these routes. Scoped to /dashboard and /api/dashboard only — the
// project-wide "Vercel Authentication" toggle was already tried and rejected
// (DECISIONS.md) because it has no per-path exceptions and would break
// /v1/* (Bearer-key API) and /api/webhooks/stripe (signature-verified).
//
// A single shared secret, issued out-of-band to the operator, gates access via
// an HttpOnly/Secure/SameSite=Lax `__Host-` cookie. This is intentionally
// minimal and temporary: it proves "you have the link the operator gave you,"
// not "you are a specific authenticated user." Fails closed if the secret
// isn't configured (or is below the entropy floor — see readDashboardSecret).
//
// This middleware is necessary but NOT sufficient on its own for Server
// Actions — see lib/assertDashboardAccess.ts for why, and the requirement
// every app/dashboard/actions.ts export must follow.
export const config = {
  matcher: ["/dashboard/:path*", "/api/dashboard/:path*"],
};

function unauthorized(body: string, status: 401 | 503): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function middleware(request: NextRequest) {
  const secret = readDashboardSecret();
  if (!secret) {
    return unauthorized("Dashboard access is not configured.", 503);
  }

  const cookieValue = request.cookies.get(DASHBOARD_ACCESS_COOKIE)?.value;
  if (cookieValue && timingSafeEqualString(cookieValue, secret)) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  const presentedKey = url.searchParams.get("key");
  if (presentedKey && timingSafeEqualString(presentedKey, secret)) {
    url.searchParams.delete("key");
    const response = NextResponse.redirect(url);
    response.cookies.set(DASHBOARD_ACCESS_COOKIE, secret, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  }

  // Never log the presented cookie/key value itself — only that an attempt
  // was made, and where from, so a brute-force pass against the secret is at
  // least visible somewhere (found in review, PR #19).
  console.warn(`[dashboard-auth] rejected ${request.method} ${url.pathname}`);
  return unauthorized(
    "Unauthorized. This dashboard requires an access link from the operator.",
    401,
  );
}
