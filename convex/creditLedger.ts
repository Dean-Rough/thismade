import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { logEvent } from "./lib/events";
import type { GenericMutationCtx } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";

async function getOrCreateBalanceRow(
  ctx: GenericMutationCtx<any>,
  businessId: Id<"businesses">,
): Promise<Doc<"creditBalances">> {
  const existing = await ctx.db
    .query("creditBalances")
    .withIndex("by_business", (q: any) => q.eq("businessId", businessId))
    .unique();
  if (existing) {
    return existing;
  }
  const now = Date.now();
  const id = await ctx.db.insert("creditBalances", {
    businessId,
    balance: 0,
    updatedAt: now,
  });
  return (await ctx.db.get(id)) as Doc<"creditBalances">;
}

// Internal-only (THI-56): every function here is fronted by the matching
// action in creditLedgerActions.ts, same pattern as THI-42.
export const getBalance = internalQuery({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("creditBalances")
      .withIndex("by_business", (q) => q.eq("businessId", args.businessId))
      .unique();
    return row?.balance ?? 0;
  },
});

// Adds credits (plan grant, refund, manual top-up). Grants aren't the write
// this ledger protects against — spends are — so this isn't gated.
export const grant = internalMutation({
  args: {
    businessId: v.id("businesses"),
    amount: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.amount <= 0) {
      throw new Error("grant_amount_must_be_positive");
    }
    const balanceRow = await getOrCreateBalanceRow(ctx, args.businessId);
    const balanceAfter = balanceRow.balance + args.amount;
    const now = Date.now();
    await ctx.db.patch(balanceRow._id, { balance: balanceAfter, updatedAt: now });
    await ctx.db.insert("creditTransactions", {
      businessId: args.businessId,
      amount: args.amount,
      balanceAfter,
      reason: args.reason,
      idempotencyKey: `grant:${balanceRow._id}:${now}`,
      createdAt: now,
    });
    return balanceAfter;
  },
});

// The credit gate (design lens: credit-gate before effect). Every
// agent-authored write must call this and see it succeed BEFORE the write it
// pays for lands — never after. Insufficient balance throws
// "insufficient_credit" and performs no debit at all, so a caller that
// forgets to check the result before proceeding still can't end up with an
// effect that outran its credit check.
//
// Idempotent on (businessId, idempotencyKey): a dispatcher retry replays the
// same spend and gets the same balanceAfter back instead of double-debiting
// — but only when the replay's amount actually matches what was originally
// debited under that key. A mismatch throws "credit_spend_conflict" instead
// of silently returning the old (smaller) balanceAfter: without this check,
// anyone who could get a cheap spend recorded under a given key first (e.g.
// calling the public `spend` mutation directly) could then have a much
// larger spend under the same key wrongly treated as "already paid for."
//
// Exported as a plain function (not just the `spend` mutation below) so
// another mutation — e.g. agentTasks.dispatch — can gate its own write in
// the *same* transaction instead of nesting a runMutation call. Convex
// mutations are atomic per-call; sharing the function is what keeps
// "spend the credit" and "perform the write it pays for" one atomic unit.
export async function spendCredits(
  ctx: GenericMutationCtx<any>,
  args: {
    businessId: Id<"businesses">;
    amount: number;
    reason: string;
    idempotencyKey: string;
    taskId?: Id<"agentTasks">;
  },
): Promise<{
  balanceAfter: number;
  replayed: boolean;
  transactionId?: Id<"creditTransactions">;
  eventId?: Id<"agentEvents">;
}> {
  if (args.amount <= 0) {
    throw new Error("spend_amount_must_be_positive");
  }

  const existing = await ctx.db
    .query("creditTransactions")
    .withIndex("by_business_idempotency_key", (q: any) =>
      q.eq("businessId", args.businessId).eq("idempotencyKey", args.idempotencyKey),
    )
    .unique();
  if (existing) {
    if (existing.amount !== -args.amount) {
      throw new Error("credit_spend_conflict");
    }
    return { balanceAfter: existing.balanceAfter, replayed: true, transactionId: existing._id };
  }

  const balanceRow = await getOrCreateBalanceRow(ctx, args.businessId);
  if (balanceRow.balance < args.amount) {
    throw new Error("insufficient_credit");
  }

  const balanceAfter = balanceRow.balance - args.amount;
  const now = Date.now();
  await ctx.db.patch(balanceRow._id, { balance: balanceAfter, updatedAt: now });
  const transactionId = await ctx.db.insert("creditTransactions", {
    businessId: args.businessId,
    amount: -args.amount,
    balanceAfter,
    reason: args.reason,
    taskId: args.taskId,
    idempotencyKey: args.idempotencyKey,
    createdAt: now,
  });
  const eventId = await logEvent(ctx, {
    businessId: args.businessId,
    taskId: args.taskId,
    actor: "system",
    event: {
      kind: "credit_debit",
      taskId: args.taskId,
      amount: -args.amount,
      balanceAfter,
      reason: args.reason,
    },
    createdAt: now,
  });

  return { balanceAfter, replayed: false, transactionId, eventId };
}

export const spend = internalMutation({
  args: {
    businessId: v.id("businesses"),
    amount: v.number(),
    reason: v.string(),
    idempotencyKey: v.string(),
    taskId: v.optional(v.id("agentTasks")),
  },
  handler: async (ctx, args) => spendCredits(ctx, args),
});
