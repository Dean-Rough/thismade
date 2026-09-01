import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc, Id } from "./_generated/dataModel";

// Public entry points for convex/businesses.ts's internal functions. Each
// action exists only to check the shared service secret (THI-42) before
// delegating — the tenancy/lookup logic itself is unchanged and still lives
// in the internal function.
//
// The explicit return type annotations below break a circular type
// inference Convex hits when an action's inferred return type flows back
// through the generated `internal`/`api` objects this same file contributes
// to.
// Not called by any /v1 route today (there's no signup flow yet) — this
// exists so operator/test tooling (e.g. smoke/commerce-e2e.test.ts) has a
// legitimate, secret-gated way to seed a business against a live deployment
// instead of going through a now-removed public mutation.
export const create = action({
  args: {
    name: v.string(),
    slug: v.string(),
    ownerUserId: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, { secret, ...args }): Promise<Id<"businesses">> => {
    assertServiceSecret(secret);
    return ctx.runMutation(internal.businesses.create, args);
  },
});

export const getSelf = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (ctx, args): Promise<Doc<"businesses"> | null> => {
    assertServiceSecret(args.secret);
    return ctx.runQuery(internal.businesses.getSelf, { businessId: args.businessId });
  },
});

export const updateCheckoutReturnUrl = action({
  args: {
    businessId: v.id("businesses"),
    checkoutReturnUrl: v.string(),
    secret: v.string(),
  },
  handler: async (ctx, args): Promise<Doc<"businesses"> | null> => {
    assertServiceSecret(args.secret);
    return ctx.runMutation(internal.businesses.updateCheckoutReturnUrl, {
      businessId: args.businessId,
      checkoutReturnUrl: args.checkoutReturnUrl,
    });
  },
});
