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
//
// The secret comparison is constant-time (THI-61, CWE-208 hardening flagged
// during THI-59 sign-off). This file has no "use node" directive, so it runs
// in Convex's default isolate runtime, which doesn't expose
// node:crypto.timingSafeEqual — only Web Crypto (`crypto.subtle`), same as
// lib/fulfillmentHmac.ts. Both inputs are hashed to a fixed-length digest
// first so the byte-by-byte compare never has to branch on input length.
const encoder = new TextEncoder();

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function assertServiceSecret(secret: string): Promise<void> {
  const expected = process.env.CONVEX_SERVICE_SECRET;
  if (!expected) {
    throw new Error("service_secret_not_configured");
  }
  const [actualDigest, expectedDigest] = await Promise.all([sha256(secret), sha256(expected)]);
  if (!timingSafeEqual(actualDigest, expectedDigest)) {
    throw new Error("unauthorized");
  }
}
