import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "@/lib/adminAuth";

const ADMIN_COOKIE = "admin_session";

/**
 * Gates every /admin route. A valid `?token=` establishes a session cookie;
 * thereafter the cookie itself is re-verified (signature + expiry + subject)
 * on every request — there is no server-side session store to trust, and
 * nothing here calls the platform's Convex deployment (see THI-42).
 */
export async function middleware(request: NextRequest) {
  const secret = process.env.ADMIN_JWT_SECRET;
  const businessSlug = process.env.BUSINESS_SLUG;

  if (!secret || !businessSlug) {
    // Fail closed: an unconfigured deployment must not silently allow admin access.
    return new NextResponse("Admin gate is not configured", { status: 500 });
  }

  const url = request.nextUrl;
  const tokenParam = url.searchParams.get("token");

  if (tokenParam) {
    const claims = await verifyAdminToken(tokenParam, secret, businessSlug);
    if (!claims) {
      return new NextResponse("Invalid or expired admin token", { status: 401 });
    }

    const redirectUrl = new URL(url);
    redirectUrl.searchParams.delete("token");
    const response = NextResponse.redirect(redirectUrl);
    response.cookies.set(ADMIN_COOKIE, tokenParam, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/admin",
      maxAge: Math.max(0, claims.exp - Math.floor(Date.now() / 1000)),
    });
    return response;
  }

  const cookieToken = request.cookies.get(ADMIN_COOKIE)?.value;
  if (!cookieToken) {
    return new NextResponse("Admin session required", { status: 401 });
  }

  const claims = await verifyAdminToken(cookieToken, secret, businessSlug);
  if (!claims) {
    const response = new NextResponse("Invalid or expired admin session", { status: 401 });
    response.cookies.delete(ADMIN_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
