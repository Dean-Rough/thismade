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

export const DASHBOARD_ACCESS_COOKIE = "dashboard_access";
