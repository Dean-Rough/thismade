import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Tenant root. Not itself businessId-scoped — it IS the tenant.
  businesses: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerUserId: v.string(), // Clerk user id of the owning member.
    lifecycleStatus: v.union(
      v.literal("active"),
      v.literal("suspended"),
    ),
    checkoutReturnUrl: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_slug", ["slug"])
    .index("by_owner_user_id", ["ownerUserId"]),

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
});
