import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";
import { getConvexServiceSecret } from "./serviceSecret";

export type ApiAuthContext = {
  businessId: Id<"businesses">;
  apiKeyId: Id<"apiKeys">;
  scopes: ("read" | "write" | "money" | "ads")[];
};

export type ApiAuthResult =
  | { ok: true; context: ApiAuthContext }
  | { ok: false; reason: "missing" | "malformed" | "invalid" };

function getConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}

export async function authenticateRequest(req: Request): Promise<ApiAuthResult> {
  const header = req.headers.get("authorization");
  if (!header) {
    return { ok: false, reason: "missing" };
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return { ok: false, reason: "malformed" };
  }
  const rawKey = match[1].trim();
  if (!rawKey) {
    return { ok: false, reason: "malformed" };
  }

  const hashedKey = await hashApiKey(rawKey);
  const client = getConvexClient();
  const secret = getConvexServiceSecret();
  const key = await client.action(api.apiKeysActions.verifyByHash, { hashedKey, secret });
  if (!key) {
    return { ok: false, reason: "invalid" };
  }

  void client.action(api.apiKeysActions.touchLastUsed, { apiKeyId: key._id, secret });

  return {
    ok: true,
    context: {
      businessId: key.businessId,
      apiKeyId: key._id,
      scopes: key.scopes,
    },
  };
}

export function requireScope(
  context: ApiAuthContext,
  scope: "read" | "write" | "money" | "ads",
): boolean {
  return context.scopes.includes(scope);
}
