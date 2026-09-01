// Constant-time comparison, same technique as convex/lib/serviceAuth.ts's
// timingSafeEqual (that one can't be imported here — it's Convex-side code
// bundled separately — so this is a deliberate, small duplication rather
// than reaching across that boundary for six lines).
function timingSafeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let i = 0; i < length; i++) {
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}

// See middleware.ts. Extracted as a pure function so the actual credential
// check is unit-testable without constructing a NextRequest.
export function verifyBasicAuthHeader(
  header: string | null,
  expectedUser: string,
  expectedPassword: string,
): boolean {
  if (!header || !header.startsWith("Basic ")) {
    return false;
  }
  let decoded: string;
  try {
    decoded = atob(header.slice("Basic ".length));
  } catch {
    return false;
  }
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return false;
  }
  const suppliedUser = decoded.slice(0, separatorIndex);
  const suppliedPassword = decoded.slice(separatorIndex + 1);
  return (
    timingSafeEqual(suppliedUser, expectedUser) && timingSafeEqual(suppliedPassword, expectedPassword)
  );
}
