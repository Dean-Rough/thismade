// Server-only: the shared secret this app's trusted backend presents to the
// Convex actions in convex/*Actions.ts. Never expose this value to a client
// (no NEXT_PUBLIC_ prefix) — anyone holding it could invoke the actions that
// front tenancy-sensitive internal functions. See convex/lib/serviceAuth.ts.
export function getConvexServiceSecret(): string {
  const secret = process.env.CONVEX_SERVICE_SECRET;
  if (!secret) {
    throw new Error("CONVEX_SERVICE_SECRET is not configured");
  }
  return secret;
}
