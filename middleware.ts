import { NextResponse, type NextRequest } from "next/server";
import { verifyBasicAuthHeader } from "@/lib/dashboard-auth";

// The dashboard has no real session/login layer yet (DECISIONS.md's Phase 1
// §frontend / Clerk-removal entries — "the app currently has no gate at
// all... pending a decision from the human"). THI-17 is what turns that from
// a static, dataless placeholder into a live surface that reads a business's
// full agent history and accepts owner-attributed chat messages and
// destructive-tool-call approvals. Left ungated, that's a public prompt-
// injection and approval-bypass surface, not just an information leak — so
// this is a scoped stopgap (HTTP Basic on exactly these two path prefixes),
// not an attempt to solve the real multi-user auth question the DECISIONS.md
// entries above explicitly deferred. Scoped narrowly (not project-wide, e.g.
// Vercel's own deployment protection) because that was already tried and
// rejected: it has no per-path exceptions and would 302 Stripe's webhook and
// block every /v1 API consumer (see that same Clerk-removal entry).
export const config = {
  matcher: ["/dashboard/:path*", "/api/dashboard/:path*"],
};

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="thismade dashboard"' },
  });
}

export function middleware(request: NextRequest): NextResponse {
  const user = process.env.DASHBOARD_BASIC_AUTH_USER;
  const password = process.env.DASHBOARD_BASIC_AUTH_PASSWORD;
  // Fail closed — an unset gate must never silently mean "open," matching
  // convex/lib/serviceAuth.ts's assertServiceSecret and the storefront
  // template's admin/fulfillment boundaries (DECISIONS.md's §security entry).
  if (!user || !password) {
    return unauthorized();
  }

  if (!verifyBasicAuthHeader(request.headers.get("authorization"), user, password)) {
    return unauthorized();
  }

  return NextResponse.next();
}
