// Verifies Stripe webhook signatures locally (HMAC-SHA256 over the raw body,
// per https://stripe.com/docs/webhooks#verify-manually) using Web Crypto
// instead of the `stripe` npm SDK, matching this repo's fetch-only Stripe
// footprint (see DECISIONS.md §products). No outbound network call is
// involved, so this is plain, fully unit-testable crypto.

const DEFAULT_TOLERANCE_SECONDS = 300;

export class StripeSignatureError extends Error {}

export type StripeWebhookEvent = {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
};

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseSignatureHeader(header: string): { timestamp: string; signatures: string[] } {
  const parts = header.split(",").reduce<Record<string, string[]>>((acc, pair) => {
    const [key, value] = pair.split("=");
    if (!key || value === undefined) return acc;
    (acc[key] ??= []).push(value);
    return acc;
  }, {});
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 ?? [];
  if (!timestamp || signatures.length === 0) {
    throw new StripeSignatureError("Malformed Stripe-Signature header.");
  }
  return { timestamp, signatures };
}

// Parses and verifies a raw webhook request body against the Stripe-Signature
// header, throwing StripeSignatureError on any mismatch, malformed header, or
// stale timestamp (possible replay). Returns the parsed event on success.
export async function constructStripeEvent(
  payload: string,
  signatureHeader: string | null,
  secret: string,
  opts: { toleranceSeconds?: number; now?: number } = {},
): Promise<StripeWebhookEvent> {
  if (!signatureHeader) {
    throw new StripeSignatureError("Missing Stripe-Signature header.");
  }
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new StripeSignatureError("Malformed Stripe-Signature timestamp.");
  }
  const tolerance = opts.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = (opts.now ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - timestampSeconds) > tolerance) {
    throw new StripeSignatureError("Stripe-Signature timestamp is outside the allowed tolerance.");
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const expected = toHex(digest);

  if (!signatures.includes(expected)) {
    throw new StripeSignatureError("Stripe-Signature verification failed.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new StripeSignatureError("Webhook payload is not valid JSON.");
  }
  return parsed as StripeWebhookEvent;
}
