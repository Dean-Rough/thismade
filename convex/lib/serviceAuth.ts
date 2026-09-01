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
//
// The secret comparison is constant-time (THI-63, CWE-208 hardening). This
// function is imported by every `*Actions.ts` file across the app, all of
// which call it synchronously today — an async, hash-then-compare version
// (as used by the storefront's own copy, see THI-61) would need `await` added
// at every call site, and any call added later without it would silently skip
// the check (a rejected promise the caller never observes). To stay a
// drop-in, call-site-compatible fix, the compare stays synchronous: encode
// both values to bytes and XOR-accumulate over the longer length so the
// number of operations never depends on where — or whether — they diverge.
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length === bBytes.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export function assertServiceSecret(secret: string): void {
  const expected = process.env.CONVEX_SERVICE_SECRET;
  if (!expected) {
    throw new Error("service_secret_not_configured");
  }
  if (!timingSafeEqual(secret, expected)) {
    throw new Error("unauthorized");
  }
}
