import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function makeBusiness(t: ReturnType<typeof convexTest>, slug: string) {
  return t.mutation(internal.businesses.create, {
    name: `Business ${slug}`,
    slug,
    ownerUserId: `user_${slug}`,
  });
}

describe("creditLedger: credit-gate before effect", () => {
  it("rejects a spend against a zero balance and performs no debit", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "credit-a");

    await expect(
      t.mutation(internal.creditLedger.spend, {
        businessId,
        amount: 5,
        reason: "worker turn",
        idempotencyKey: "spend-1",
      }),
    ).rejects.toThrow("insufficient_credit");

    expect(await t.query(internal.creditLedger.getBalance, { businessId })).toBe(0);
    const events = await t.query(internal.agentEvents.listByBusiness, { businessId });
    expect(events).toHaveLength(0);
  });

  it("debits on success, floors at zero balance never going negative, and logs a credit_debit event", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "credit-b");

    await t.mutation(internal.creditLedger.grant, {
      businessId,
      amount: 100,
      reason: "starter grant",
    });

    const result = await t.mutation(internal.creditLedger.spend, {
      businessId,
      amount: 30,
      reason: "worker turn",
      idempotencyKey: "spend-1",
    });
    expect(result.balanceAfter).toBe(70);
    expect(result.replayed).toBe(false);

    expect(await t.query(internal.creditLedger.getBalance, { businessId })).toBe(70);

    const events = await t.query(internal.agentEvents.listByBusiness, { businessId });
    expect(events).toHaveLength(1);
    expect(events[0].event.kind).toBe("credit_debit");

    await expect(
      t.mutation(internal.creditLedger.spend, {
        businessId,
        amount: 1000,
        reason: "runaway spend",
        idempotencyKey: "spend-2",
      }),
    ).rejects.toThrow("insufficient_credit");
    expect(await t.query(internal.creditLedger.getBalance, { businessId })).toBe(70);
  });

  it("replays an already-applied spend on a repeated idempotencyKey instead of double-debiting", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "credit-c");
    await t.mutation(internal.creditLedger.grant, {
      businessId,
      amount: 50,
      reason: "starter grant",
    });

    const first = await t.mutation(internal.creditLedger.spend, {
      businessId,
      amount: 20,
      reason: "worker turn",
      idempotencyKey: "retry-key",
    });
    const second = await t.mutation(internal.creditLedger.spend, {
      businessId,
      amount: 20,
      reason: "worker turn (retry)",
      idempotencyKey: "retry-key",
    });

    expect(first.balanceAfter).toBe(30);
    expect(second.balanceAfter).toBe(30);
    expect(second.replayed).toBe(true);
    expect(await t.query(internal.creditLedger.getBalance, { businessId })).toBe(30);
  });
});

describe("creditLedger: tenancy", () => {
  it("keeps balances independent per business", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await makeBusiness(t, "credit-tenancy-a");
    const businessBId = await makeBusiness(t, "credit-tenancy-b");

    await t.mutation(internal.creditLedger.grant, {
      businessId: businessAId,
      amount: 100,
      reason: "grant",
    });

    expect(await t.query(internal.creditLedger.getBalance, { businessId: businessAId })).toBe(100);
    expect(await t.query(internal.creditLedger.getBalance, { businessId: businessBId })).toBe(0);
  });
});
