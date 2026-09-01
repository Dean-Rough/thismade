/**
 * Admin JWT gate primitives.
 *
 * These verify a compact HS256 JWT entirely within this repo's own process,
 * using a secret that is unique per storefront deployment (see
 * ADMIN_JWT_SECRET in .env.example). Verification never calls out to the
 * platform's Convex deployment or any other service — THI-42 found the
 * platform Convex backend has zero auth on its functions, so this boundary
 * must not lean on it.
 *
 * Uses Web Crypto (`crypto.subtle`) rather than Node's `crypto` module so the
 * same code runs unmodified in Next.js middleware (edge or Node runtime) and
 * in route handlers.
 */

export interface AdminTokenClaims {
  /** Business slug this token was minted for. */
  sub: string;
  /** Issued-at, unix seconds. */
  iat: number;
  /** Expiry, unix seconds. */
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signAdminToken(
  params: { businessSlug: string; ttlSeconds?: number },
  secret: string,
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const claims: AdminTokenClaims = {
    sub: params.businessSlug,
    iat: now,
    exp: now + (params.ttlSeconds ?? 900),
  };
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signingInput));
  const sigB64 = base64UrlEncode(new Uint8Array(signature));
  return `${signingInput}.${sigB64}`;
}

/**
 * Verifies a token's signature, expiry, and that it was minted for
 * `expectedBusinessSlug`. Returns the validated claims, or null for any
 * failure — malformed input, bad signature, expired, or wrong subject all
 * fail the same way so callers can't distinguish rejection reasons from a
 * timing side channel.
 */
export async function verifyAdminToken(
  token: string,
  secret: string,
  expectedBusinessSlug: string,
): Promise<AdminTokenClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;

  let header: unknown;
  let payload: unknown;
  try {
    header = JSON.parse(decoder.decode(base64UrlDecode(headerB64)));
    payload = JSON.parse(decoder.decode(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }

  if (
    typeof header !== "object" ||
    header === null ||
    (header as Record<string, unknown>).alg !== "HS256" ||
    (header as Record<string, unknown>).typ !== "JWT"
  ) {
    return null;
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(sigB64);
  } catch {
    return null;
  }

  const key = await importHmacKey(secret);
  const signingInput = `${headerB64}.${payloadB64}`;
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as BufferSource,
    encoder.encode(signingInput),
  );
  if (!valid) return null;

  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof (payload as Record<string, unknown>).sub !== "string" ||
    typeof (payload as Record<string, unknown>).iat !== "number" ||
    typeof (payload as Record<string, unknown>).exp !== "number"
  ) {
    return null;
  }

  const claims = payload as AdminTokenClaims;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds >= claims.exp) return null;
  if (claims.sub !== expectedBusinessSlug) return null;

  return claims;
}
