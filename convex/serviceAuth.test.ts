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
