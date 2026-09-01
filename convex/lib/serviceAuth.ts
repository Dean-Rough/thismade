// The trust boundary between the Next.js `/v1` REST layer (which already does
// real Bearer-key auth via lib/api/auth.ts) and this Convex deployment. Every
// domain table is exposed only as internalQuery/internalMutation — unreachable
// from the public Convex HTTP API by Convex's own enforcement — and fronted by
// a thin public `action` per operation that exists solely to check this
// shared secret before delegating via ctx.runQuery/ctx.runMutation. Without
// it, anyone who discovers the deployment URL could call any function
// directly (see THI-42): the secret is what makes these actions
// service-to-service only, not a substitute for the tenancy checks already
// enforced inside each internal function.
export function assertServiceSecret(secret: string): void {
  const expected = process.env.CONVEX_SERVICE_SECRET;
  if (!expected) {
    throw new Error("service_secret_not_configured");
  }
  if (secret !== expected) {
    throw new Error("unauthorized");
  }
}
