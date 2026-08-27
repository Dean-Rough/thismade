import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    const signInUrl = new URL("/sign-in", req.url);
    signInUrl.searchParams.set("redirect_url", req.url);
    await auth.protect({ unauthenticatedUrl: signInUrl.toString() });
  }
});

// `/v1/*` (API-key authenticated commerce API) and `/api/*` (e.g. the Stripe
// webhook, authenticated by Stripe's signature) are machine-to-machine
// routes with no Clerk session. They're excluded from the matcher entirely
// rather than just marked public, so they never require Clerk keys and can
// never be redirected to /sign-in by auth.protect().
export const config = {
  matcher: [
    "/((?!_next|v1/|api/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
  ],
};
