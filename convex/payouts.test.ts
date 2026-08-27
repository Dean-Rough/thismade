import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function seedTwoBusinesses(t: ReturnType<typeof convexTest>) {
  const businessAId = await t.mutation(api.businesses.create, {
    name: "Business A",
    slug: `payouts-a-${Math.random().toString(36).slice(2)}`,
    ownerUserId: "user_a",
  });
  const businessBId = await t.mutation(api.businesses.create, {
    name: "Business B",
    slug: `payouts-b-${Math.random().toString(36).slice(2)}`,
    ownerUserId: "user_b",
  });
  return { businessAId, businessBId };
}

describe("payouts.getConnectStatus", () => {
  it("starts false/false/false with no account id, per the Phase 2 acceptance criterion", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    const status = await t.query(api.payouts.getConnectStatus, { businessId: businessAId });

    expect(status).toEqual({
      stripeConnectAccountId: null,
      stripeConnectDetailsSubmitted: false,
      stripeConnectChargesEnabled: false,
      stripeConnectPayoutsEnabled: false,
    });
  });

  it("returns null for a business id that doesn't resolve, never another business's status", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);
    await t.run(async (ctx) => {
      await ctx.db.delete(businessAId);
    });

    const status = await t.query(api.payouts.getConnectStatus, { businessId: businessAId });
    expect(status).toBeNull();
  });
});

describe("payouts.setStripeConnectAccountId", () => {
  it("sets the account id once", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    const updated = await t.mutation(api.payouts.setStripeConnectAccountId, {
      businessId: businessAId,
      stripeConnectAccountId: "acct_test_123",
    });

    expect(updated?.stripeConnectAccountId).toBe("acct_test_123");
  });

  it("does not overwrite an existing account id on a retried onboarding-link call", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);

    await t.mutation(api.payouts.setStripeConnectAccountId, {
      businessId: businessAId,
      stripeConnectAccountId: "acct_test_first",
    });
    const second = await t.mutation(api.payouts.setStripeConnectAccountId, {
      businessId: businessAId,
      stripeConnectAccountId: "acct_test_second",
    });

    expect(second?.stripeConnectAccountId).toBe("acct_test_first");
  });
});

describe("payouts.updateConnectStatusByStripeAccountId: the account.updated webhook path", () => {
  it("flips the three flags for the business owning that Connect account id", async () => {
    const t = convexTest(schema, modules);
    const { businessAId } = await seedTwoBusinesses(t);
    await t.mutation(api.payouts.setStripeConnectAccountId, {
      businessId: businessAId,
      stripeConnectAccountId: "acct_test_a",
    });

    await t.mutation(api.payouts.updateConnectStatusByStripeAccountId, {
      stripeConnectAccountId: "acct_test_a",
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: true,
    });

    const status = await t.query(api.payouts.getConnectStatus, { businessId: businessAId });
    expect(status).toEqual({
      stripeConnectAccountId: "acct_test_a",
      stripeConnectDetailsSubmitted: true,
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    });
  });

  it("never touches a different business's flags, even with two accounts onboarding concurrently", async () => {
    const t = convexTest(schema, modules);
    const { businessAId, businessBId } = await seedTwoBusinesses(t);
    await t.mutation(api.payouts.setStripeConnectAccountId, {
      businessId: businessAId,
      stripeConnectAccountId: "acct_test_a",
    });
    await t.mutation(api.payouts.setStripeConnectAccountId, {
      businessId: businessBId,
      stripeConnectAccountId: "acct_test_b",
    });

    await t.mutation(api.payouts.updateConnectStatusByStripeAccountId, {
      stripeConnectAccountId: "acct_test_a",
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: true,
    });

    const statusA = await t.query(api.payouts.getConnectStatus, { businessId: businessAId });
    const statusB = await t.query(api.payouts.getConnectStatus, { businessId: businessBId });

    expect(statusA?.stripeConnectPayoutsEnabled).toBe(true);
    expect(statusB?.stripeConnectPayoutsEnabled).toBe(false);
    expect(statusB?.stripeConnectDetailsSubmitted).toBe(false);
  });

  it("is a safe no-op for an account id with no matching business", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(api.payouts.updateConnectStatusByStripeAccountId, {
      stripeConnectAccountId: "acct_test_unknown",
      detailsSubmitted: true,
      chargesEnabled: true,
      payoutsEnabled: true,
    });
    expect(result).toBeNull();
  });
});
