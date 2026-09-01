import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertServiceSecret } from "./lib/serviceAuth";
import type { Doc } from "./_generated/dataModel";

// Public entry points for convex/domains.ts (+ the Node-runtime DNS lookup in
// convex/domainsVerify.ts). Same shape as businessesActions.ts (THI-42): each
// action only checks the shared service secret before delegating — the
// tenancy/lookup/DNS logic itself lives in the internal functions.
export const listByBusiness = action({
  args: { businessId: v.id("businesses"), secret: v.string() },
  handler: async (ctx, args): Promise<Doc<"domains">[]> => {
    assertServiceSecret(args.secret);
    return ctx.runQuery(internal.domains.listByBusiness, { businessId: args.businessId });
  },
});

export const addDomain = action({
  args: { businessId: v.id("businesses"), hostname: v.string(), secret: v.string() },
  handler: async (ctx, args): Promise<Doc<"domains">> => {
    assertServiceSecret(args.secret);
    return ctx.runMutation(internal.domains.addDomain, {
      businessId: args.businessId,
      hostname: args.hostname,
    });
  },
});

export const verifyDomain = action({
  args: { businessId: v.id("businesses"), domainId: v.id("domains"), secret: v.string() },
  handler: async (ctx, args): Promise<Doc<"domains">> => {
    assertServiceSecret(args.secret);
    return ctx.runAction(internal.domainsVerify.verifyDomain, {
      businessId: args.businessId,
      domainId: args.domainId,
    });
  },
});
