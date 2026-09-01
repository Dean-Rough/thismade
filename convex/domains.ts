import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { getScoped } from "./lib/tenancy";
import type { Doc } from "./_generated/dataModel";

// Platform-managed storefront zone — must match scripts/deploy-storefront.mjs's
// STOREFRONT_DOMAIN_BASE default exactly, so a hostname this repo already
// provisions automatically (Vercel is authoritative for the whole
// storefronts.rough.ink zone, per DECISIONS.md §THI-57) is recognized as
// "nothing for the owner to add" rather than computing a bogus CNAME for a
// record Vercel already manages.
const STOREFRONT_DOMAIN_BASE =
  process.env.STOREFRONT_DOMAIN_BASE ?? "storefronts.rough.ink";

// Bounded, non-backtracking hostname validation (THI-84 precedent: this repo
// has twice shipped ReDoS via nested-quantifier regexes over untrusted
// strings). Each label is checked independently with a single bounded
// quantifier — no alternation-of-repetition that could blow up on
// adversarial input.
const LABEL_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;

function isValidHostname(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) {
    return false;
  }
  const labels = hostname.split(".");
  if (labels.length < 2) {
    return false;
  }
  return labels.every((label) => LABEL_RE.test(label));
}

export const listByBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args): Promise<Doc<"domains">[]> => {
    return ctx.db
      .query("domains")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});

export const getById = internalQuery({
  args: { businessId: v.id("businesses"), domainId: v.id("domains") },
  handler: async (ctx, args): Promise<Doc<"domains"> | null> => {
    return getScoped<Doc<"domains">>(ctx.db, args.domainId, args.businessId);
  },
});

export const addDomain = internalMutation({
  args: { businessId: v.id("businesses"), hostname: v.string() },
  handler: async (ctx, args): Promise<Doc<"domains">> => {
    const hostname = args.hostname.trim().toLowerCase();
    if (!isValidHostname(hostname)) {
      throw new Error("invalid_hostname");
    }

    // Hostnames are globally unique in DNS — reject a second business
    // claiming one already registered to any business, not just this one.
    const existing = await ctx.db
      .query("domains")
      .withIndex("by_hostname", (q) => q.eq("hostname", hostname))
      .unique();
    if (existing) {
      throw new Error("hostname_taken");
    }

    const business = await ctx.db.get(args.businessId);
    if (!business) {
      throw new Error("not_found");
    }

    const platformHostname = `${business.slug}.${STOREFRONT_DOMAIN_BASE}`;
    const isPlatformManaged = hostname === platformHostname;

    // Platform-managed subdomains are auto-provisioned by
    // scripts/deploy-storefront.mjs's `vercel domains add` against a zone
    // Vercel is already authoritative for — no DNS record for the owner to
    // add. Everything else is bring-your-own-domain: point it at the
    // business's platform-hosted storefront, and prove ownership with a TXT
    // challenge before treating it as verified.
    const records = isPlatformManaged
      ? []
      : [
          { type: "CNAME", host: hostname, value: platformHostname },
          {
            type: "TXT",
            host: `_thismade-verify.${hostname}`,
            value: `thismade-domain-verification=${crypto.randomUUID()}`,
          },
        ];

    const domainId = await ctx.db.insert("domains", {
      businessId: args.businessId,
      hostname,
      status: "pending",
      records,
      createdAt: Date.now(),
      lastCheckedAt: null,
    });
    const domain = await ctx.db.get(domainId);
    if (!domain) {
      throw new Error("not_found");
    }
    return domain;
  },
});

// Called only by convex/domainsVerify.ts's Node-runtime action once it has
// performed the real DNS lookup — this half stays in the default runtime so
// the write is a normal transactional mutation, not part of the Node action.
export const recordVerificationResult = internalMutation({
  args: {
    businessId: v.id("businesses"),
    domainId: v.id("domains"),
    status: v.union(v.literal("verified"), v.literal("failed")),
  },
  handler: async (ctx, args): Promise<Doc<"domains">> => {
    const domain = await getScoped<Doc<"domains">>(ctx.db, args.domainId, args.businessId);
    if (!domain) {
      throw new Error("not_found");
    }
    await ctx.db.patch(args.domainId, {
      status: args.status,
      lastCheckedAt: Date.now(),
    });
    const updated = await ctx.db.get(args.domainId);
    if (!updated) {
      throw new Error("not_found");
    }
    return updated;
  },
});
