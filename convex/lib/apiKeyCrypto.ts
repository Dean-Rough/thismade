/**
 * Shared by convex/apiKeys.ts and lib/api/auth.ts. Uses Web Crypto (available
 * in both the Convex runtime and Node 20+) so the hashing logic is identical
 * on both sides of the boundary — a key minted here must hash the same way
 * it's verified.
 */
const KEY_PREFIX_VISIBLE_CHARS = 12;

export async function hashApiKey(rawKey: string): Promise<string> {
  const data = new TextEncoder().encode(rawKey);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function generateRawApiKey(mode: "test" | "live"): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const secret = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `tm_${mode}_${secret}`;
}

export function visiblePrefix(rawKey: string): string {
  return rawKey.slice(0, KEY_PREFIX_VISIBLE_CHARS);
}
