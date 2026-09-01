import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc, Id } from "./_generated/dataModel";

const SCOPE = v.union(
  v.literal("read"),
  v.literal("write"),
  v.literal("money"),
  v.literal("ads"),
);

// Public entry points for convex/apiKeys.ts's internal functions, gated by
// the shared service secret (THI-42). verifyByHash is the REST auth bootstrap
// itself — it can't be gated by the API key it's verifying, so the service
// secret is the only thing standing between an anonymous caller and every
// business's hashed key records.
//
// `create` isn't called by any /v1 route today (there's no key-issuance flow
// yet) — it exists so operator/test tooling (e.g. smoke/commerce-e2e.test.ts)
// has a legitimate, secret-gated way to mint a key against a live deployment.
//
// The explicit return type annotation below breaks a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to — see convex/businessesActions.ts and convex/productsActions.ts for the
// same pattern.
export const create = action({
  args: {
    businessId: v.id("businesses"),
    name: v.string(),
    prefix: v.string(),
    hashedKey: v.string(),
    scopes: v.array(SCOPE),
    createdByUserId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Id<"apiKeys">> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.apiKeys.create, args);
  },
});

export const verifyByHash = action({
  args: { hashedKey: v.string(), secret: v.string() },
  handler: async (ctx, args): Promise<Doc<"apiKeys"> | null> => {
    assertServiceSecret(args.secret);
    return ctx.runQuery(internal.apiKeys.verifyByHash, { hashedKey: args.hashedKey });
  },
});

export const touchLastUsed = action({
  args: { apiKeyId: v.id("apiKeys"), secret: v.string() },
  handler: async (ctx, args) => {
    assertServiceSecret(args.secret);
    await ctx.runMutation(internal.apiKeys.touchLastUsed, { apiKeyId: args.apiKeyId });
  },
});
