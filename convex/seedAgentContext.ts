import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  BRAND_IDENTITY_KIT_SKILL_KEY,
  CONTEXT_FILE_KEYS,
  renderAllContextFiles,
  renderBrandIdentityKitSkill,
} from "./lib/agentContextTemplates";

// THI-47: lands the content templates from lib/agentContextTemplates.ts
// through the *existing* agentContextFiles.upsert / agentSkills.upsert
// mutations (see THI-8) — this file adds no new storage or CRUD surface.
//
// This is an action, not a mutation: convex mutations cannot call other
// mutations (ctx.runMutation only exists on ActionCtx — see DECISIONS.md's
// note on why agentTasks.dispatch inlines spendCredits instead of nesting
// runMutation calls). Each upsert below is its own atomic mutation, which
// is fine here — context files/skills are independent rows with no
// cross-file atomicity requirement, unlike a credit debit tied to a task
// insert.
export const seedDefaults = action({
  args: {
    businessId: v.id("businesses"),
    ownerName: v.optional(v.string()),
    ownerEmail: v.optional(v.string()),
    offerSummary: v.optional(v.string()),
    targetAudience: v.optional(v.string()),
    // Injected by the caller instead of read with `Date.now()` inside the
    // action, so a re-run against the same business is reproducible and
    // doesn't backdate MEMORY.md's seed entry to whenever it happens to be
    // re-run.
    provisionedAtIso: v.string(),
  },
  handler: async (ctx, args) => {
    // businesses.getSelf is internal-only (THI-42) — this action already
    // runs server-side inside Convex, so it reaches it directly rather than
    // through the secret-gated businessesActions.getSelf front door that
    // external callers use.
    const business = await ctx.runQuery(internal.businesses.getSelf, {
      businessId: args.businessId,
    });
    if (!business) {
      throw new Error("not_found");
    }

    const files = renderAllContextFiles({
      businessName: business.name,
      businessSlug: business.slug,
      ownerName: args.ownerName,
      ownerEmail: args.ownerEmail,
      offerSummary: args.offerSummary,
      targetAudience: args.targetAudience,
      checkoutReturnUrl: business.checkoutReturnUrl,
      payoutsEnabled: business.stripeConnectPayoutsEnabled,
      provisionedAtIso: args.provisionedAtIso,
    });

    for (const fileKey of CONTEXT_FILE_KEYS) {
      await ctx.runMutation(api.agentContextFiles.upsert, {
        businessId: args.businessId,
        fileKey,
        content: files[fileKey],
      });
    }

    await ctx.runMutation(api.agentSkills.upsert, {
      businessId: args.businessId,
      skillKey: BRAND_IDENTITY_KIT_SKILL_KEY,
      content: renderBrandIdentityKitSkill(),
    });

    return {
      businessId: args.businessId,
      fileKeys: CONTEXT_FILE_KEYS,
      skillKeys: [BRAND_IDENTITY_KIT_SKILL_KEY],
    };
  },
});
