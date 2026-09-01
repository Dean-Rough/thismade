import { NextRequest, NextResponse } from "next/server";

import { DASHBOARD_ACCESS_COOKIE, timingSafeEqualString } from "@/lib/dashboardAuth";

// THI-90: interim gate for /dashboard* — there is no session/identity layer yet
// (Clerk was removed, see DECISIONS.md's Clerk-removal entry), and THI-17 wired
// real destructive Server Actions (tool-call approval, task close-out, owner
// chat) to these routes. Scoped to /dashboard and /api/dashboard only — the
// project-wide "Vercel Authentication" toggle was already tried and rejected
// (DECISIONS.md) because it has no per-path exceptions and would break
// /v1/* (Bearer-key API) and /api/webhooks/stripe (signature-verified).
//
// A single shared secret, issued out-of-band to the operator, gates access via
// an HttpOnly/Secure/SameSite=Lax cookie. This is intentionally minimal and
// temporary: it proves "you have the link the operator gave you," not "you are
// a specific authenticated user." Fails closed if the secret isn't configured.
export const config = {
  matcher: ["/dashboard/:path*", "/api/dashboard/:path*"],
};

export function middleware(request: NextRequest) {
  const secret = process.env.DASHBOARD_ACCESS_SECRET;
  if (!secret) {
    return new NextResponse("Dashboard access is not configured.", { status: 503 });
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
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  }

  return new NextResponse(
    "Unauthorized. This dashboard requires an access link from the operator.",
    { status: 401 },
  );
}
