import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { richContentEvent } from "./lib/richContent";

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

  // Phase 3 (agent core, THI-8): CEO->worker kanban board. Lifecycle is
  // strictly todo -> in_progress -> needs_review -> done; see
  // convex/agentTasks.ts advanceStatus for the allowed-transition table.
  // `pendingApproval` (THI-66) is an orthogonal in_progress-only side gate,
  // not a fifth kanban column — see that field's own comment below.
  agentTasks: defineTable({
    businessId: v.id("businesses"),
    title: v.string(),
    description: v.string(),
    workerType: v.union(
      v.literal("coding"),
      v.literal("browser"),
      v.literal("marketing"),
    ),
    status: v.union(
      v.literal("todo"),
      v.literal("in_progress"),
      v.literal("needs_review"),
      v.literal("done"),
    ),
    // Caller-supplied stable key for the CEO's dispatch decision (e.g. a hash
    // of businessId + the planning turn that produced this task). Dispatch
    // retries (reconnect, crash) replay the same key instead of double
    // creating the task — see agentTasks.dispatch.
    dispatchKey: v.string(),
    // Credit-gated at dispatch time (creditLedger.spend, keyed on
    // dispatchKey) — see agentTasks.dispatch. Stored on the row too so the
    // board can render "this task cost N credits" without a ledger join.
    creditCost: v.number(),
    // Trust-boundary tag (THI-62): the dispatcher's explicit declaration of
    // whether `instructions` embeds lower-trust input (chat text, catalog
    // copy, a webhook payload) rather than being purely its own words. No
    // default — see agentTasks.dispatch for why the caller must say.
    containsUntrustedContent: v.boolean(),
    attemptCount: v.number(),
    maxAttempts: v.number(),
    // Circuit breaker: set once attemptCount reaches maxAttempts on the same
    // failure. A circuit-broken task must surface for owner/CEO attention,
    // never silently retry again.
    circuitBroken: v.boolean(),
    // THI-66: set by agentTasks.requestToolApproval when the worker loop
    // pauses before executing a destructive tool call (see
    // convex/lib/workerTools.ts's isDestructiveToolCall), cleared by
    // agentTasks.resolveToolApproval. Distinct from the needs_review -> done
    // gate: status stays "in_progress" while this is set — a destructive
    // call can happen well before a task otherwise finishes.
    pendingApproval: v.optional(
      v.object({
        toolName: v.string(),
        argsSummary: v.string(),
        requestedAt: v.number(),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_status", ["businessId", "status"])
    .index("by_business_dispatch_key", ["businessId", "dispatchKey"]),

  // Phase 3: the typed richContent timeline every UI surface (chat, kanban
  // card detail, audit log) reads from instead of free-text logs.
  agentEvents: defineTable({
    businessId: v.id("businesses"),
    taskId: v.optional(v.id("agentTasks")),
    actor: v.union(
      v.literal("owner"),
      v.literal("ceo"),
      v.literal("worker"),
      v.literal("system"),
    ),
    event: richContentEvent,
    createdAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_task", ["taskId"]),

  // Phase 3: running per-business credit balance. Every agent-authored write
  // must pass creditLedger.spend (check-then-debit in one transaction)
  // *before* the write it's paying for lands — see creditLedger.spend.
  creditBalances: defineTable({
    businessId: v.id("businesses"),
    balance: v.number(),
    updatedAt: v.number(),
  }).index("by_business", ["businessId"]),

  // Append-only audit trail behind creditBalances. idempotencyKey lets a
  // dispatcher retry replay the same spend instead of double-debiting, the
  // same check-then-insert idiom as idempotencyKeys/orders.
  creditTransactions: defineTable({
    businessId: v.id("businesses"),
    amount: v.number(), // negative = debit, positive = grant/refund
    balanceAfter: v.number(),
    reason: v.string(),
    taskId: v.optional(v.id("agentTasks")),
    idempotencyKey: v.string(),
    createdAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_idempotency_key", ["businessId", "idempotencyKey"]),

  // Phase 3: canonical per-business agent context files (SOUL/OWNER/BUSINESS/
  // PLATFORM/PLAYBOOK/RUNBOOK/MEMORY/CODE_MAP). This table is the storage
  // layer only — the generated *content* templates are a separate,
  // Security & Compliance Reviewer-gated workstream (see THI-8 child issues);
  // no template text lives here yet.
  agentContextFiles: defineTable({
    businessId: v.id("businesses"),
    fileKey: v.union(
      v.literal("SOUL"),
      v.literal("OWNER"),
      v.literal("BUSINESS"),
      v.literal("PLATFORM"),
      v.literal("PLAYBOOK"),
      v.literal("RUNBOOK"),
      v.literal("MEMORY"),
      v.literal("CODE_MAP"),
    ),
    content: v.string(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_file_key", ["businessId", "fileKey"]),

  // Phase 3: skills-as-files — reusable capabilities as versioned prompt
  // files attached to a business (e.g. a "brandkit" image-gen skill), same
  // storage-only/no-template-content split as agentContextFiles above and
  // for the same reason (Security & Compliance Reviewer-gated IP boundary).
  // skillKey is a free string, not a closed literal union like fileKey —
  // the whole point of "skills-as-files" is that new skills attach without
  // a schema change.
  agentSkills: defineTable({
    businessId: v.id("businesses"),
    skillKey: v.string(),
    version: v.number(),
    content: v.string(),
    updatedAt: v.number(),
  })
    .index("by_business", ["businessId"])
    .index("by_business_skill_key", ["businessId", "skillKey"]),
});
