import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
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
//
// Internal-only (THI-42, extended per THI-55 review): this used to be a
// public `action` with no auth check at all — any caller who knew the
// deployment URL could overwrite a business's entire agent identity (all 8
// context files + the brandkit skill) with attacker-chosen content just by
// supplying its businessId. Fronted by a secret-gated public action in
// seedAgentContextActions.ts, same split as every other domain under THI-42.
export const seedDefaults = internalAction({
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
      await ctx.runMutation(internal.agentContextFiles.upsert, {
        businessId: args.businessId,
        fileKey,
        content: files[fileKey],
      });
    }

    await ctx.runMutation(internal.agentSkills.upsert, {
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
