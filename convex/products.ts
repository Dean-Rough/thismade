import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { getScoped } from "./lib/tenancy";
import type { Doc } from "./_generated/dataModel";

const STATUS = v.union(v.literal("active"), v.literal("draft"), v.literal("archived"));

// Internal-only (THI-42): every function here is fronted by the matching
// action in productsActions.ts for the /v1 REST layer's use.
export const create = internalMutation({
  args: {
    businessId: v.id("businesses"),
    title: v.string(),
    description: v.string(),
    priceAmountCents: v.number(),
    currency: v.string(),
    deliverableFileUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("products", {
      businessId: args.businessId,
      title: args.title,
      description: args.description,
      priceAmountCents: args.priceAmountCents,
      currency: args.currency,
      status: "draft",
      deliverableFileUrl: args.deliverableFileUrl,
    });
    return ctx.db.get(id);
  },
});

// The tenancy contract on the products table: a different business asking
// for the same id gets null, indistinguishable from a nonexistent id. The
// REST layer turns this into a plain 404, never a 403.
export const getScopedById = internalQuery({
  args: {
    productId: v.id("products"),
    businessId: v.id("businesses"),
  },
  handler: async (ctx, args): Promise<Doc<"products"> | null> => {
    return getScoped<Doc<"products">>(ctx.db, args.productId, args.businessId);
  },
});

// Patches only the fields provided. `status` covers archiving (just
// `status: "archived"`) and activation. `stripeProductId`/`stripePriceId`
// are supplied by the REST layer after a successful test-mode Stripe sync —
// Convex mutations can't make outbound HTTP calls, so that sync happens
// before this mutation is invoked and is passed in as plain data.
export const update = internalMutation({
  args: {
    businessId: v.id("businesses"),
    productId: v.id("products"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priceAmountCents: v.optional(v.number()),
    currency: v.optional(v.string()),
    status: v.optional(STATUS),
    deliverableFileUrl: v.optional(v.string()),
    stripeProductId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await getScoped<Doc<"products">>(ctx.db, args.productId, args.businessId);
    if (!existing) {
      return null;
    }

    const patch: Partial<Doc<"products">> = {};
    if (args.title !== undefined) patch.title = args.title;
    if (args.description !== undefined) patch.description = args.description;
    if (args.priceAmountCents !== undefined) patch.priceAmountCents = args.priceAmountCents;
    if (args.currency !== undefined) patch.currency = args.currency;
    if (args.status !== undefined) patch.status = args.status;
    if (args.deliverableFileUrl !== undefined) patch.deliverableFileUrl = args.deliverableFileUrl;
    if (args.stripeProductId !== undefined) patch.stripeProductId = args.stripeProductId;
    if (args.stripePriceId !== undefined) patch.stripePriceId = args.stripePriceId;

    await ctx.db.patch(args.productId, patch);
    return ctx.db.get(args.productId);
  },
});

export const listByBusiness = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    return ctx.db
      .query("products")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .collect();
  },
});
