// THI-90: interim gate for `/dashboard*` until real session auth exists (DECISIONS.md).
// Mirrors the constant-time comparison in convex/lib/serviceAuth.ts (THI-63, CWE-208) —
// same reasoning applies: compare UTF-16 code units over the longer length so the
// operation count never depends on where the strings diverge.
export function timingSafeEqualString(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}

// `__Host-` requires (and the browser enforces) Secure + Path=/ + no Domain
// attribute on this cookie, which is exactly the config middleware.ts sets —
// that's what stops a sibling `*.rough.ink` subdomain (this product scaffolds
// one per storefront business) from setting a same-named `Domain=.rough.ink`
// cookie that could shadow or fixate the operator's session (found in review,
// PR #19).
export const DASHBOARD_ACCESS_COOKIE = "__Host-dashboard_access";

// A short/placeholder secret (e.g. "x") would still pass a bare truthiness
// check and make the gate trivially guessable. Treat anything under this
// floor as unconfigured — fails closed via the same path as an unset var,
// rather than silently accepting a weak value (found in review, PR #19).
export const MIN_DASHBOARD_SECRET_LENGTH = 32;

export function readDashboardSecret(): string | null {
  const secret = process.env.DASHBOARD_ACCESS_SECRET;
  if (!secret || secret.length < MIN_DASHBOARD_SECRET_LENGTH) {
    return null;
  }
  return secret;
}
