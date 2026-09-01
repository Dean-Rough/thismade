// The trust boundary between this storefront's Next.js server (the only
// legitimate caller) and its own Convex deployment. `fulfillmentEvents.ts`
// exposes only internalMutation/internalQuery — unreachable from the public
// Convex HTTP API by Convex's own enforcement — fronted by a thin public
// `action` per operation in fulfillmentEventsActions.ts that exists solely
// to check this shared secret before delegating via ctx.runQuery/
// ctx.runMutation. Without it, anyone who reads NEXT_PUBLIC_CONVEX_URL out
// of the public bundle could call the functions directly (THI-53), bypassing
// both the POST /api/fulfillment HMAC boundary and the /admin JWT gate.
// Mirrors the platform's own fix for the same vulnerability class (THI-42).
export function assertServiceSecret(secret: string): void {
  const expected = process.env.CONVEX_SERVICE_SECRET;
  if (!expected) {
    throw new Error("service_secret_not_configured");
  }
  if (secret !== expected) {
    throw new Error("unauthorized");
  }
}
