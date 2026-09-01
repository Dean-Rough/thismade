import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

// THI-42: every function reachable from the public Convex HTTP API that
// touches business data must require the shared service secret. Without it,
// the deployment URL alone was enough to read API keys/order PII and
// repoint Stripe Connect payout destinations. These tests exercise the
// actions as an external caller would — through `api.*Actions`, never
// `internal.*` — since that's the only boundary this fix adds.
describe("service secret gate (THI-42)", () => {
  afterEach(() => {
    delete process.env.CONVEX_SERVICE_SECRET;
  });

  it("rejects an action call with no CONVEX_SERVICE_SECRET configured at all", async () => {
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "service-auth-unconfigured",
      ownerUserId: "user_a",
    });

    await expect(
      t.action(api.businessesActions.getSelf, { businessId, secret: "anything" }),
    ).rejects.toThrow();
  });

  it("rejects an action call with the wrong secret", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "service-auth-wrong",
      ownerUserId: "user_a",
    });

    await expect(
      t.action(api.businessesActions.getSelf, { businessId, secret: "wrong-secret" }),
    ).rejects.toThrow();
  });

  it("delegates to the internal function once the correct secret is supplied", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "service-auth-correct",
      ownerUserId: "user_a",
    });

    const business = await t.action(api.businessesActions.getSelf, {
      businessId,
      secret: "correct-secret",
    });
    expect(business?._id).toBe(businessId);
  });

  // The highest-severity finding in THI-42: an anonymous caller could
  // repoint a business's Stripe Connect payout destination. Proves the
  // public action fronting that mutation is gated the same way.
  it("blocks an unauthenticated call to the payouts.setStripeConnectAccountId action", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "service-auth-payouts",
      ownerUserId: "user_a",
    });

    await expect(
      t.action(api.payoutsActions.setStripeConnectAccountId, {
        businessId,
        stripeConnectAccountId: "acct_attacker_controlled",
        secret: "not-the-real-secret",
      }),
    ).rejects.toThrow();

    const status = await t.query(internal.payouts.getConnectStatus, { businessId });
    expect(status?.stripeConnectAccountId).toBeNull();
  });
});

// THI-56: the same gate, applied to the Phase 3 agent-core tables
// (agentTasks/agentEvents/agentSkills/agentContextFiles/creditLedger).
// Before this fix, an anonymous caller who knew the deployment URL could
// dispatch/advance agent tasks, post chat events, and grant/spend credit
// ledger balances for any business.
describe("service secret gate (THI-56)", () => {
  afterEach(() => {
    delete process.env.CONVEX_SERVICE_SECRET;
  });

  // The highest-severity finding: an anonymous caller could grant itself
  // credits, or spend a business's balance with no ownership check.
  it("blocks an unauthenticated call to the creditLedger.grant action", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "service-auth-credit-grant",
      ownerUserId: "user_a",
    });

    await expect(
      t.action(api.creditLedgerActions.grant, {
        businessId,
        amount: 1_000_000,
        reason: "attacker_controlled",
        secret: "not-the-real-secret",
      }),
    ).rejects.toThrow();

    const balance = await t.query(internal.creditLedger.getBalance, { businessId });
    expect(balance).toBe(0);
  });

  it("blocks an unauthenticated call to the agentTasks.dispatch action", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "service-auth-dispatch",
      ownerUserId: "user_a",
    });

    await expect(
      t.action(api.agentTasksActions.dispatch, {
        businessId,
        title: "attacker task",
        description: "attacker description",
        workerType: "coding",
        dispatchKey: "attacker-key",
        instructions: "do something",
        creditCost: 0,
        secret: "not-the-real-secret",
      }),
    ).rejects.toThrow();

    const tasks = await t.query(internal.agentTasks.listByBusiness, { businessId });
    expect(tasks).toHaveLength(0);
  });

  it("blocks an unauthenticated call to the agentEvents.sendChatMessage action", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "service-auth-chat",
      ownerUserId: "user_a",
    });

    await expect(
      t.action(api.agentEventsActions.sendChatMessage, {
        businessId,
        authorRole: "ceo",
        text: "attacker-injected message",
        secret: "not-the-real-secret",
      }),
    ).rejects.toThrow();

    const events = await t.query(internal.agentEvents.listByBusiness, { businessId });
    expect(events).toHaveLength(0);
  });

  it("blocks an unauthenticated call to the agentSkills.upsert and agentContextFiles.upsert actions", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "service-auth-skills-context",
      ownerUserId: "user_a",
    });

    await expect(
      t.action(api.agentSkillsActions.upsert, {
        businessId,
        skillKey: "brandkit",
        content: "attacker-controlled skill prompt",
        secret: "not-the-real-secret",
      }),
    ).rejects.toThrow();
    await expect(
      t.action(api.agentContextFilesActions.upsert, {
        businessId,
        fileKey: "SOUL",
        content: "attacker-controlled context file",
        secret: "not-the-real-secret",
      }),
    ).rejects.toThrow();

    expect(await t.query(internal.agentSkills.listByBusiness, { businessId })).toHaveLength(0);
    expect(await t.query(internal.agentContextFiles.listByBusiness, { businessId })).toHaveLength(0);
  });

  it("delegates to the internal function once the correct secret is supplied", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "service-auth-credit-correct",
      ownerUserId: "user_a",
    });

    const balance = await t.action(api.creditLedgerActions.grant, {
      businessId,
      amount: 50,
      reason: "test grant",
      secret: "correct-secret",
    });
    expect(balance).toBe(50);
  });
});
