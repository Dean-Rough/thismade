/**
 * POST /api/fulfillment HMAC-signature boundary.
 *
 * Signature scheme mirrors Stripe's webhook signing (timestamp + digest over
 * `${timestamp}.${rawBody}`) so a captured request can't be replayed outside
 * a short tolerance window. Verification is entirely local — a secret shared
 * out-of-band with the platform at scaffold time — and never depends on the
 * platform's Convex deployment, which THI-42 found has no auth of its own.
 */

const encoder = new TextEncoder();

export const FULFILLMENT_SIGNATURE_HEADER = "x-fulfillment-signature";
const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface ParsedSignatureHeader {
  timestamp: number;
  digestHex: string;
}

/** Parses `t=<unix>,v1=<hex>`. Returns null if the header is malformed. */
export function parseSignatureHeader(header: string | null): ParsedSignatureHeader | null {
  if (!header) return null;
  const parts = Object.fromEntries(
    header
      .split(",")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const eq = segment.indexOf("=");
        return eq === -1 ? [segment, ""] : [segment.slice(0, eq), segment.slice(eq + 1)];
      }),
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return null;
  const timestamp = Number(t);
  if (!Number.isFinite(timestamp)) return null;
  if (!/^[0-9a-f]+$/i.test(v1) || v1.length % 2 !== 0) return null;
  return { timestamp, digestHex: v1.toLowerCase() };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
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

/** Signs a raw request body for tests/tooling. Returns the full header value. */
export async function signFulfillmentPayload(
  rawBody: string,
  secret: string,
  timestamp: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await importHmacKey(secret);
  const signedPayload = `${timestamp}.${rawBody}`;
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const digestHex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestamp},v1=${digestHex}`;
}

/**
 * Verifies a fulfillment request's signature header against the raw body.
 * Fails closed: any parse error, digest mismatch, or stale timestamp returns
 * false. `toleranceSeconds` bounds replay of a captured, validly-signed
 * request.
 */
export async function verifyFulfillmentSignature(
  rawBody: string,
  headerValue: string | null,
  secret: string,
  options: { toleranceSeconds?: number; now?: number } = {},
): Promise<boolean> {
  const parsed = parseSignatureHeader(headerValue);
  if (!parsed) return false;

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.timestamp) > tolerance) return false;

  const key = await importHmacKey(secret);
  const signedPayload = `${parsed.timestamp}.${rawBody}`;
  return crypto.subtle.verify(
    "HMAC",
    key,
    hexToBytes(parsed.digestHex) as BufferSource,
    encoder.encode(signedPayload),
  );
}
