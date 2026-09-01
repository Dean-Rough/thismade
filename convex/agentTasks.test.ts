import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function makeBusiness(t: ReturnType<typeof convexTest>, slug: string) {
  const businessId = await t.mutation(api.businesses.create, {
    name: `Business ${slug}`,
    slug,
    ownerUserId: `user_${slug}`,
  });
  // Dispatch is credit-gated (see agentTasks.dispatch) — grant a balance
  // generous enough that lifecycle/tenancy/circuit-breaker tests, which
  // aren't exercising the credit gate itself, don't have to think about it.
  await t.mutation(api.creditLedger.grant, {
    businessId,
    amount: 1000,
    reason: "test fixture grant",
  });
  return businessId;
}

describe("agentTasks: idempotent dispatch", () => {
  it("replays the same task instead of creating a duplicate on a repeated dispatchKey", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "dispatch-a");

    const first = await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Mirror catalog products",
      description: "Sync product names from platform to storefront.",
      workerType: "coding",
      dispatchKey: "plan-turn-1:task-1",
      instructions: "Call productsInternal:getByPlatformProductId ...",
      creditCost: 10,
    });
    const second = await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Mirror catalog products",
      description: "Sync product names from platform to storefront.",
      workerType: "coding",
      dispatchKey: "plan-turn-1:task-1",
      instructions: "Call productsInternal:getByPlatformProductId ...",
      creditCost: 10,
    });

    expect(second?._id).toBe(first?._id);

    const all = await t.query(api.agentTasks.listByBusiness, { businessId });
    expect(all).toHaveLength(1);
  });

  it("logs a typed dispatch event and a taskId-linked credit_debit event alongside the created task", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "dispatch-b");

    const task = await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Draft landing copy",
      description: "Write hero + offer copy.",
      workerType: "marketing",
      dispatchKey: "plan-turn-2:task-1",
      instructions: "Match the accepted offer positioning.",
      creditCost: 10,
    });

    const events = await t.query(api.agentEvents.listByTask, {
      businessId,
      taskId: task!._id,
    });
    const kinds = events.map((e) => e.event.kind);
    expect(kinds).toContain("dispatch");
    expect(kinds).toContain("credit_debit");
  });
});

describe("agentTasks: tenancy", () => {
  it("returns null when a different business fetches another business's task by id", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await makeBusiness(t, "tenancy-a");
    const businessBId = await makeBusiness(t, "tenancy-b");

    const task = await t.mutation(api.agentTasks.dispatch, {
      businessId: businessAId,
      title: "A's task",
      description: "...",
      workerType: "coding",
      dispatchKey: "tenancy-a:task-1",
      instructions: "...",
      creditCost: 10,
    });

    const ownFetch = await t.query(api.agentTasks.getScopedById, {
      taskId: task!._id,
      businessId: businessAId,
    });
    expect(ownFetch?._id).toBe(task!._id);

    const crossTenantFetch = await t.query(api.agentTasks.getScopedById, {
      taskId: task!._id,
      businessId: businessBId,
    });
    expect(crossTenantFetch).toBeNull();
  });
});

describe("agentTasks: kanban lifecycle", () => {
  it("allows only the forward todo -> in_progress -> needs_review -> done chain", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "lifecycle-a");
    const task = await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "lifecycle-a:task-1",
      instructions: "...",
      creditCost: 10,
    });

    const afterFirst = await t.mutation(api.agentTasks.advanceStatus, {
      businessId,
      taskId: task!._id,
      toStatus: "in_progress",
    });
    expect(afterFirst?.status).toBe("in_progress");

    const afterSecond = await t.mutation(api.agentTasks.advanceStatus, {
      businessId,
      taskId: task!._id,
      toStatus: "needs_review",
    });
    expect(afterSecond?.status).toBe("needs_review");

    const afterThird = await t.mutation(api.agentTasks.advanceStatus, {
      businessId,
      taskId: task!._id,
      toStatus: "done",
    });
    expect(afterThird?.status).toBe("done");
  });

  it("rejects a skipped transition (todo -> needs_review)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "lifecycle-b");
    const task = await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "lifecycle-b:task-1",
      instructions: "...",
      creditCost: 10,
    });

    await expect(
      t.mutation(api.agentTasks.advanceStatus, {
        businessId,
        taskId: task!._id,
        toStatus: "needs_review",
      }),
    ).rejects.toThrow("invalid_transition");
  });

  it("rejects a backward transition (in_progress -> todo)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "lifecycle-c");
    const task = await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "lifecycle-c:task-1",
      instructions: "...",
      creditCost: 10,
    });
    await t.mutation(api.agentTasks.advanceStatus, {
      businessId,
      taskId: task!._id,
      toStatus: "in_progress",
    });

    await expect(
      t.mutation(api.agentTasks.advanceStatus, {
        businessId,
        taskId: task!._id,
        toStatus: "todo",
      }),
    ).rejects.toThrow("invalid_transition");
  });
});

describe("agentTasks: circuit breaker", () => {
  it("trips circuitBroken once attemptCount reaches maxAttempts and then blocks further advancement", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "circuit-a");
    const task = await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Flaky task",
      description: "...",
      workerType: "coding",
      dispatchKey: "circuit-a:task-1",
      instructions: "...",
      creditCost: 10,
      maxAttempts: 2,
    });

    const afterFirstFailure = await t.mutation(api.agentTasks.recordAttemptFailure, {
      businessId,
      taskId: task!._id,
      errorMessage: "build failed: type error",
    });
    expect(afterFirstFailure?.circuitBroken).toBe(false);

    const afterSecondFailure = await t.mutation(api.agentTasks.recordAttemptFailure, {
      businessId,
      taskId: task!._id,
      errorMessage: "build failed: type error",
    });
    expect(afterSecondFailure?.circuitBroken).toBe(true);

    await expect(
      t.mutation(api.agentTasks.advanceStatus, {
        businessId,
        taskId: task!._id,
        toStatus: "in_progress",
      }),
    ).rejects.toThrow("task_circuit_broken");
  });

  it("rejects recordAttemptFailure on an already circuit-broken task instead of incrementing further", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "circuit-b");
    const task = await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Flaky task",
      description: "...",
      workerType: "coding",
      dispatchKey: "circuit-b:task-1",
      instructions: "...",
      creditCost: 10,
      maxAttempts: 1,
    });

    await t.mutation(api.agentTasks.recordAttemptFailure, {
      businessId,
      taskId: task!._id,
      errorMessage: "build failed: type error",
    });

    await expect(
      t.mutation(api.agentTasks.recordAttemptFailure, {
        businessId,
        taskId: task!._id,
        errorMessage: "build failed again",
      }),
    ).rejects.toThrow("task_circuit_broken");
  });

  it("rejects an invalid maxAttempts and creates no task", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "circuit-c");

    await expect(
      t.mutation(api.agentTasks.dispatch, {
        businessId,
        title: "Task",
        description: "...",
        workerType: "coding",
        dispatchKey: "circuit-c:task-1",
        instructions: "...",
        creditCost: 10,
        maxAttempts: 0,
      }),
    ).rejects.toThrow("invalid_max_attempts");

    const all = await t.query(api.agentTasks.listByBusiness, { businessId });
    expect(all).toHaveLength(0);
  });
});

describe("agentTasks: credit-gated dispatch", () => {
  it("rejects dispatch against an insufficient balance and creates no task", async () => {
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(api.businesses.create, {
      name: "Business no-credit",
      slug: "no-credit",
      ownerUserId: "user_no-credit",
    });

    await expect(
      t.mutation(api.agentTasks.dispatch, {
        businessId,
        title: "Task",
        description: "...",
        workerType: "coding",
        dispatchKey: "no-credit:task-1",
        instructions: "...",
        creditCost: 10,
      }),
    ).rejects.toThrow("insufficient_credit");

    const all = await t.query(api.agentTasks.listByBusiness, { businessId });
    expect(all).toHaveLength(0);
    expect(await t.query(api.creditLedger.getBalance, { businessId })).toBe(0);
  });

  it("debits exactly creditCost on a successful dispatch", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "credit-dispatch-a");

    const task = await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "credit-dispatch-a:task-1",
      instructions: "...",
      creditCost: 40,
    });
    expect(task?.creditCost).toBe(40);
    expect(await t.query(api.creditLedger.getBalance, { businessId })).toBe(1000 - 40);
  });

  it("does not double-debit when a dispatch is replayed on the same dispatchKey", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "credit-dispatch-b");

    await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "credit-dispatch-b:task-1",
      instructions: "...",
      creditCost: 40,
    });
    await t.mutation(api.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "credit-dispatch-b:task-1",
      instructions: "...",
      creditCost: 40,
    });

    expect(await t.query(api.creditLedger.getBalance, { businessId })).toBe(1000 - 40);
  });

  it("rejects a dispatch whose credit spend collides with an unrelated already-recorded idempotencyKey at a different amount", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "credit-dispatch-c");

    // Simulates an attacker (or a caller bug) that gets a cheap spend
    // recorded under the exact key agentTasks.dispatch will derive from this
    // dispatchKey, then tries to dispatch a much more expensive task under
    // that same dispatchKey hoping the credit gate treats it as "already
    // paid for."
    await t.mutation(api.creditLedger.spend, {
      businessId,
      amount: 1,
      reason: "attacker-controlled cheap spend",
      idempotencyKey: "dispatch:credit-dispatch-c:task-1",
    });

    await expect(
      t.mutation(api.agentTasks.dispatch, {
        businessId,
        title: "Task",
        description: "...",
        workerType: "coding",
        dispatchKey: "credit-dispatch-c:task-1",
        instructions: "...",
        creditCost: 500,
      }),
    ).rejects.toThrow("credit_spend_conflict");

    const all = await t.query(api.agentTasks.listByBusiness, { businessId });
    expect(all).toHaveLength(0);
    // Only the attacker's original 1-credit spend landed — dispatch created
    // no task and took no additional credit.
    expect(await t.query(api.creditLedger.getBalance, { businessId })).toBe(1000 - 1);
  });
});

describe("agentTasks: dispatchKey is business-scoped", () => {
  it("lets two businesses independently dispatch under the identical dispatchKey string", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await makeBusiness(t, "dispatch-scope-a");
    const businessBId = await makeBusiness(t, "dispatch-scope-b");

    const taskA = await t.mutation(api.agentTasks.dispatch, {
      businessId: businessAId,
      title: "SECRET A ROADMAP",
      description: "A's confidential task",
      workerType: "coding",
      dispatchKey: "plan-turn-1:task-1",
      instructions: "...",
      creditCost: 10,
    });

    const taskB = await t.mutation(api.agentTasks.dispatch, {
      businessId: businessBId,
      title: "B's own task",
      description: "...",
      workerType: "coding",
      dispatchKey: "plan-turn-1:task-1",
      instructions: "...",
      creditCost: 10,
    });

    expect(taskB?._id).not.toBe(taskA?._id);
    expect(taskB?.businessId).toBe(businessBId);
    expect(taskB?.title).toBe("B's own task");
    // B was debited for its own dispatch, not silently exempted because A
    // already used the same dispatchKey string.
    expect(await t.query(api.creditLedger.getBalance, { businessId: businessBId })).toBe(1000 - 10);

    const bTasks = await t.query(api.agentTasks.listByBusiness, { businessId: businessBId });
    expect(bTasks.map((t) => t.title)).not.toContain("SECRET A ROADMAP");
  });
});
