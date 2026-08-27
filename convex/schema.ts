import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Tenant root. Not itself businessId-scoped — it IS the tenant.
  businesses: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerUserId: v.string(), // Owning member's user id; not populated from any real auth session yet (see DECISIONS.md Clerk-removal entry).
    lifecycleStatus: v.union(
      v.literal("active"),
      v.literal("suspended"),
    ),
    checkoutReturnUrl: v.optional(v.string()),
    // Stripe Connect Express (test-mode) payout onboarding — see convex/payouts.ts.
    stripeConnectAccountId: v.optional(v.string()),
    stripeConnectDetailsSubmitted: v.optional(v.boolean()),
    stripeConnectChargesEnabled: v.optional(v.boolean()),
    stripeConnectPayoutsEnabled: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_owner_user_id", ["ownerUserId"])
    // Stripe's account.updated webhook only carries the Connect account id,
    // not our businessId, so lookups from the webhook go through this index.
    .index("by_stripe_connect_account_id", ["stripeConnectAccountId"]),

  // Every row below this point is businessId-scoped from day one.
  // Cross-tenant reads/writes must resolve to "not found", never "forbidden" —
  // see convex/lib/tenancy.ts for the shared enforcement helper.
  apiKeys: defineTable({
    businessId: v.id("businesses"),
    name: v.string(),
    prefix: v.string(), // First chars of the key, shown in UI (e.g. "tm_test_ab12").
    hashedKey: v.string(), // SHA-256 hex digest of the full secret. Never store the raw key.
    scopes: v.array(
      v.union(
        v.literal("read"),
        v.literal("write"),
        v.literal("money"),
        v.literal("ads"),
      ),
    ),
    createdByUserId: v.string(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_business", ["businessId"])
    .index("by_hashed_key", ["hashedKey"]),

  products: defineTable({
    businessId: v.id("businesses"),
    title: v.string(),
    description: v.string(),
    priceAmountCents: v.number(),
    currency: v.string(),
    stripeProductId: v.optional(v.string()),
    stripePriceId: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("draft"), v.literal("archived")),
    deliverableFileUrl: v.optional(v.string()),
  }).index("by_business", ["businessId"]),

  // Backs the Idempotency-Key middleware for /v1 mutation endpoints.
  idempotencyKeys: defineTable({
    businessId: v.id("businesses"),
    key: v.string(), // The client-supplied Idempotency-Key header value.
    route: v.string(), // e.g. "PATCH /v1/business" — scopes the key to one endpoint.
    requestHash: v.string(), // Hash of the request body, to detect key reuse with a different payload.
    status: v.union(v.literal("in_progress"), v.literal("completed")),
    responseStatus: v.optional(v.number()),
    responseBody: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    // One key is unique per business + route (not globally) — see api_reference §Idempotency.
    .index("by_business_route_key", ["businessId", "route", "key"]),

  // Tenancy wrapper around Convex's own (business-agnostic) file storage —
  // see DECISIONS.md Phase 2 §files for why this table exists and how
  // `files.completeUpload` uses it to enforce the cross-tenant 404 contract.
  files: defineTable({
    businessId: v.id("businesses"),
    storageId: v.optional(v.id("_storage")), // Set once the upload completes.
    status: v.union(v.literal("pending"), v.literal("complete")),
    createdAt: v.number(),
  }).index("by_business", ["businessId"]),

  // First written by the checkout.session.completed webhook (convex/orders.ts,
  // app/api/webhooks/stripe/route.ts); read/mutated by the Orders API ticket.
  // `status` only tracks paid/refunded — shipped/refunded are independent
  // facts (a shipped order can later be refunded), so they're their own
  // optional fields rather than folded into a single mutually-exclusive
  // status union. See DECISIONS.md §orders.
  orders: defineTable({
    businessId: v.id("businesses"),
    productId: v.id("products"),
    customerEmail: v.string(),
    amountCents: v.number(),
    currency: v.string(),
    status: v.union(v.literal("paid"), v.literal("refunded")),
    shippedAt: v.optional(v.number()),
    shippingTrackingCode: v.optional(v.string()),
    refundedAt: v.optional(v.number()),
    stripeCheckoutSessionId: v.string(),
    createdAt: v.number(),
  })
    .index("by_business", ["businessId"])
    // Redelivered webhooks (Stripe retries checkout.session.completed on
    // timeout, or a manual resend) must not create a second order — see
    // orders.createFromCheckoutSession's check-then-insert against this index.
    .index("by_stripe_session", ["stripeCheckoutSessionId"]),
});
