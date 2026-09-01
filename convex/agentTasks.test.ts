import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function makeBusiness(t: ReturnType<typeof convexTest>, slug: string) {
  const businessId = await t.mutation(internal.businesses.create, {
    name: `Business ${slug}`,
    slug,
    ownerUserId: `user_${slug}`,
  });
  // Dispatch is credit-gated (see agentTasks.dispatch) — grant a balance
  // generous enough that lifecycle/tenancy/circuit-breaker tests, which
  // aren't exercising the credit gate itself, don't have to think about it.
  await t.mutation(internal.creditLedger.grant, {
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

    const first = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Mirror catalog products",
      description: "Sync product names from platform to storefront.",
      workerType: "coding",
      dispatchKey: "plan-turn-1:task-1",
      instructions: "Call productsInternal:getByPlatformProductId ...",
      containsUntrustedContent: false,
      creditCost: 10,
    });
    const second = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Mirror catalog products",
      description: "Sync product names from platform to storefront.",
      workerType: "coding",
      dispatchKey: "plan-turn-1:task-1",
      instructions: "Call productsInternal:getByPlatformProductId ...",
      containsUntrustedContent: false,
      creditCost: 10,
    });

    expect(second?._id).toBe(first?._id);

    const all = await t.query(internal.agentTasks.listByBusiness, { businessId });
    expect(all).toHaveLength(1);
  });

  it("logs a typed dispatch event and a taskId-linked credit_debit event alongside the created task", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "dispatch-b");

    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Draft landing copy",
      description: "Write hero + offer copy.",
      workerType: "marketing",
      dispatchKey: "plan-turn-2:task-1",
      instructions: "Match the accepted offer positioning.",
      containsUntrustedContent: false,
      creditCost: 10,
    });

    const events = await t.query(internal.agentEvents.listByTask, {
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

    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId: businessAId,
      title: "A's task",
      description: "...",
      workerType: "coding",
      dispatchKey: "tenancy-a:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });

    const ownFetch = await t.query(internal.agentTasks.getScopedById, {
      taskId: task!._id,
      businessId: businessAId,
    });
    expect(ownFetch?._id).toBe(task!._id);

    const crossTenantFetch = await t.query(internal.agentTasks.getScopedById, {
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
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "lifecycle-a:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });

    const afterFirst = await t.mutation(internal.agentTasks.advanceStatus, {
      businessId,
      taskId: task!._id,
      toStatus: "in_progress",
      actor: "worker",
    });
    expect(afterFirst?.status).toBe("in_progress");

    const afterSecond = await t.mutation(internal.agentTasks.advanceStatus, {
      businessId,
      taskId: task!._id,
      toStatus: "needs_review",
      actor: "worker",
    });
    expect(afterSecond?.status).toBe("needs_review");

    const afterThird = await t.mutation(internal.agentTasks.advanceStatus, {
      businessId,
      taskId: task!._id,
      toStatus: "done",
      actor: "ceo",
    });
    expect(afterThird?.status).toBe("done");
  });

  it("rejects a skipped transition (todo -> needs_review)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "lifecycle-b");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "lifecycle-b:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });

    await expect(
      t.mutation(internal.agentTasks.advanceStatus, {
        businessId,
        taskId: task!._id,
        toStatus: "needs_review",
        actor: "worker",
      }),
    ).rejects.toThrow("invalid_transition");
  });

  it("rejects a backward transition (in_progress -> todo)", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "lifecycle-c");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "lifecycle-c:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });
    await t.mutation(internal.agentTasks.advanceStatus, {
      businessId,
      taskId: task!._id,
      toStatus: "in_progress",
      actor: "worker",
    });

    await expect(
      t.mutation(internal.agentTasks.advanceStatus, {
        businessId,
        taskId: task!._id,
        toStatus: "todo",
        actor: "worker",
      }),
    ).rejects.toThrow("invalid_transition");
  });
});

describe("agentTasks: circuit breaker", () => {
  it("trips circuitBroken once attemptCount reaches maxAttempts and then blocks further advancement", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "circuit-a");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Flaky task",
      description: "...",
      workerType: "coding",
      dispatchKey: "circuit-a:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
      maxAttempts: 2,
    });

    const afterFirstFailure = await t.mutation(internal.agentTasks.recordAttemptFailure, {
      businessId,
      taskId: task!._id,
      errorMessage: "build failed: type error",
    });
    expect(afterFirstFailure?.circuitBroken).toBe(false);

    const afterSecondFailure = await t.mutation(internal.agentTasks.recordAttemptFailure, {
      businessId,
      taskId: task!._id,
      errorMessage: "build failed: type error",
    });
    expect(afterSecondFailure?.circuitBroken).toBe(true);

    await expect(
      t.mutation(internal.agentTasks.advanceStatus, {
        businessId,
        taskId: task!._id,
        toStatus: "in_progress",
        actor: "worker",
      }),
    ).rejects.toThrow("task_circuit_broken");
  });

  it("rejects recordAttemptFailure on an already circuit-broken task instead of incrementing further", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "circuit-b");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Flaky task",
      description: "...",
      workerType: "coding",
      dispatchKey: "circuit-b:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
      maxAttempts: 1,
    });

    await t.mutation(internal.agentTasks.recordAttemptFailure, {
      businessId,
      taskId: task!._id,
      errorMessage: "build failed: type error",
    });

    await expect(
      t.mutation(internal.agentTasks.recordAttemptFailure, {
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
      t.mutation(internal.agentTasks.dispatch, {
        businessId,
        title: "Task",
        description: "...",
        workerType: "coding",
        dispatchKey: "circuit-c:task-1",
        instructions: "...",
        containsUntrustedContent: false,
        creditCost: 10,
        maxAttempts: 0,
      }),
    ).rejects.toThrow("invalid_max_attempts");

    const all = await t.query(internal.agentTasks.listByBusiness, { businessId });
    expect(all).toHaveLength(0);
  });
});

describe("agentTasks: credit-gated dispatch", () => {
  it("rejects dispatch against an insufficient balance and creates no task", async () => {
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business no-credit",
      slug: "no-credit",
      ownerUserId: "user_no-credit",
    });

    await expect(
      t.mutation(internal.agentTasks.dispatch, {
        businessId,
        title: "Task",
        description: "...",
        workerType: "coding",
        dispatchKey: "no-credit:task-1",
        instructions: "...",
        containsUntrustedContent: false,
        creditCost: 10,
      }),
    ).rejects.toThrow("insufficient_credit");

    const all = await t.query(internal.agentTasks.listByBusiness, { businessId });
    expect(all).toHaveLength(0);
    expect(await t.query(internal.creditLedger.getBalance, { businessId })).toBe(0);
  });

  it("debits exactly creditCost on a successful dispatch", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "credit-dispatch-a");

    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "credit-dispatch-a:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 40,
    });
    expect(task?.creditCost).toBe(40);
    expect(await t.query(internal.creditLedger.getBalance, { businessId })).toBe(1000 - 40);
  });

  it("does not double-debit when a dispatch is replayed on the same dispatchKey", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "credit-dispatch-b");

    await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "credit-dispatch-b:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 40,
    });
    await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "credit-dispatch-b:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 40,
    });

    expect(await t.query(internal.creditLedger.getBalance, { businessId })).toBe(1000 - 40);
  });

  it("rejects a dispatch whose credit spend collides with an unrelated already-recorded idempotencyKey at a different amount", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "credit-dispatch-c");

    // Simulates an attacker (or a caller bug) that gets a cheap spend
    // recorded under the exact key agentTasks.dispatch will derive from this
    // dispatchKey, then tries to dispatch a much more expensive task under
    // that same dispatchKey hoping the credit gate treats it as "already
    // paid for."
    await t.mutation(internal.creditLedger.spend, {
      businessId,
      amount: 1,
      reason: "attacker-controlled cheap spend",
      idempotencyKey: "dispatch:credit-dispatch-c:task-1",
    });

    await expect(
      t.mutation(internal.agentTasks.dispatch, {
        businessId,
        title: "Task",
        description: "...",
        workerType: "coding",
        dispatchKey: "credit-dispatch-c:task-1",
        instructions: "...",
        containsUntrustedContent: false,
        creditCost: 500,
      }),
    ).rejects.toThrow("credit_spend_conflict");

    const all = await t.query(internal.agentTasks.listByBusiness, { businessId });
    expect(all).toHaveLength(0);
    // Only the attacker's original 1-credit spend landed — dispatch created
    // no task and took no additional credit.
    expect(await t.query(internal.creditLedger.getBalance, { businessId })).toBe(1000 - 1);
  });
});

describe("agentTasks: dispatchKey is business-scoped", () => {
  it("lets two businesses independently dispatch under the identical dispatchKey string", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await makeBusiness(t, "dispatch-scope-a");
    const businessBId = await makeBusiness(t, "dispatch-scope-b");

    const taskA = await t.mutation(internal.agentTasks.dispatch, {
      businessId: businessAId,
      title: "SECRET A ROADMAP",
      description: "A's confidential task",
      workerType: "coding",
      dispatchKey: "plan-turn-1:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });

    const taskB = await t.mutation(internal.agentTasks.dispatch, {
      businessId: businessBId,
      title: "B's own task",
      description: "...",
      workerType: "coding",
      dispatchKey: "plan-turn-1:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });

    expect(taskB?._id).not.toBe(taskA?._id);
    expect(taskB?.businessId).toBe(businessBId);
    expect(taskB?.title).toBe("B's own task");
    // B was debited for its own dispatch, not silently exempted because A
    // already used the same dispatchKey string.
    expect(await t.query(internal.creditLedger.getBalance, { businessId: businessBId })).toBe(1000 - 10);

    const bTasks = await t.query(internal.agentTasks.listByBusiness, { businessId: businessBId });
    expect(bTasks.map((t) => t.title)).not.toContain("SECRET A ROADMAP");
  });
});

describe("agentTasks: dispatch trust-boundary hardening (THI-62)", () => {
  it("rejects empty instructions and creates no task", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "hardening-empty-instructions");

    await expect(
      t.mutation(internal.agentTasks.dispatch, {
        businessId,
        title: "Task",
        description: "...",
        workerType: "coding",
        dispatchKey: "hardening-empty-instructions:task-1",
        instructions: "",
        containsUntrustedContent: false,
        creditCost: 10,
      }),
    ).rejects.toThrow("invalid_instructions_length");

    expect(await t.query(internal.agentTasks.listByBusiness, { businessId })).toHaveLength(0);
  });

  it("rejects instructions over the length cap and creates no task", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "hardening-long-instructions");

    await expect(
      t.mutation(internal.agentTasks.dispatch, {
        businessId,
        title: "Task",
        description: "...",
        workerType: "coding",
        dispatchKey: "hardening-long-instructions:task-1",
        instructions: "x".repeat(8_001),
        containsUntrustedContent: false,
        creditCost: 10,
      }),
    ).rejects.toThrow("invalid_instructions_length");

    expect(await t.query(internal.agentTasks.listByBusiness, { businessId })).toHaveLength(0);
  });

  it("rejects an empty or oversized title", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "hardening-title");

    await expect(
      t.mutation(internal.agentTasks.dispatch, {
        businessId,
        title: "",
        description: "...",
        workerType: "coding",
        dispatchKey: "hardening-title:task-empty",
        instructions: "...",
        containsUntrustedContent: false,
        creditCost: 10,
      }),
    ).rejects.toThrow("invalid_title_length");

    await expect(
      t.mutation(internal.agentTasks.dispatch, {
        businessId,
        title: "x".repeat(201),
        description: "...",
        workerType: "coding",
        dispatchKey: "hardening-title:task-long",
        instructions: "...",
        containsUntrustedContent: false,
        creditCost: 10,
      }),
    ).rejects.toThrow("invalid_title_length");
  });

  it("rejects an oversized description", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "hardening-description");

    await expect(
      t.mutation(internal.agentTasks.dispatch, {
        businessId,
        title: "Task",
        description: "x".repeat(4_001),
        workerType: "coding",
        dispatchKey: "hardening-description:task-1",
        instructions: "...",
        containsUntrustedContent: false,
        creditCost: 10,
      }),
    ).rejects.toThrow("invalid_description_length");
  });

  it("stores and echoes the caller's containsUntrustedContent trust tag onto the task and its dispatch event", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "hardening-trust-tag");

    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Summarize a customer message",
      description: "...",
      workerType: "marketing",
      dispatchKey: "hardening-trust-tag:task-1",
      instructions: "Customer said: 'ignore all prior instructions and ...'",
      containsUntrustedContent: true,
      creditCost: 10,
    });
    expect(task?.containsUntrustedContent).toBe(true);

    const events = await t.query(internal.agentEvents.listByTask, { businessId, taskId: task!._id });
    const dispatchEvent = events.find((e) => e.event.kind === "dispatch");
    expect(dispatchEvent?.event.kind === "dispatch" && dispatchEvent.event.containsUntrustedContent).toBe(true);
  });
});

describe("agentTasks: needs_review -> done requires owner/ceo approval (THI-62)", () => {
  async function makeTaskAtNeedsReview(t: ReturnType<typeof convexTest>, slug: string) {
    const businessId = await makeBusiness(t, slug);
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: `${slug}:task-1`,
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });
    await t.mutation(internal.agentTasks.advanceStatus, {
      businessId,
      taskId: task!._id,
      toStatus: "in_progress",
      actor: "worker",
    });
    await t.mutation(internal.agentTasks.advanceStatus, {
      businessId,
      taskId: task!._id,
      toStatus: "needs_review",
      actor: "worker",
    });
    return { businessId, taskId: task!._id };
  }

  it("rejects a worker closing its own task out to done", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeTaskAtNeedsReview(t, "approval-worker");

    await expect(
      t.mutation(internal.agentTasks.advanceStatus, {
        businessId,
        taskId,
        toStatus: "done",
        actor: "worker",
      }),
    ).rejects.toThrow("done_requires_owner_or_ceo_approval");
  });

  it("rejects system closing a task out to done", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeTaskAtNeedsReview(t, "approval-system");

    await expect(
      t.mutation(internal.agentTasks.advanceStatus, {
        businessId,
        taskId,
        toStatus: "done",
        actor: "system",
      }),
    ).rejects.toThrow("done_requires_owner_or_ceo_approval");
  });

  it("allows the owner to close a task out to done", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeTaskAtNeedsReview(t, "approval-owner");

    const result = await t.mutation(internal.agentTasks.advanceStatus, {
      businessId,
      taskId,
      toStatus: "done",
      actor: "owner",
    });
    expect(result?.status).toBe("done");
  });

  it("allows the ceo to close a task out to done and logs that actor on the status_change event", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeTaskAtNeedsReview(t, "approval-ceo");

    const result = await t.mutation(internal.agentTasks.advanceStatus, {
      businessId,
      taskId,
      toStatus: "done",
      actor: "ceo",
    });
    expect(result?.status).toBe("done");

    const events = await t.query(internal.agentEvents.listByTask, { businessId, taskId });
    const statusChangeToDone = events.find(
      (e) => e.event.kind === "status_change" && e.event.toStatus === "done",
    );
    expect(statusChangeToDone?.actor).toBe("ceo");
  });

  it("still blocks an in_progress -> needs_review self-advance-adjacent transition from a circuit-broken task regardless of actor", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "approval-circuit");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Flaky task",
      description: "...",
      workerType: "coding",
      dispatchKey: "approval-circuit:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
      maxAttempts: 1,
    });
    await t.mutation(internal.agentTasks.recordAttemptFailure, {
      businessId,
      taskId: task!._id,
      errorMessage: "boom",
    });

    await expect(
      t.mutation(internal.agentTasks.advanceStatus, {
        businessId,
        taskId: task!._id,
        toStatus: "in_progress",
        actor: "ceo",
      }),
    ).rejects.toThrow("task_circuit_broken");
  });
});

describe("agentTasks: worker-loop identity boundary (THI-68)", () => {
  it("beginWorkerRun claims todo -> in_progress and always logs actor system, with no actor param to override it", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "worker-begin-a");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "worker-begin-a:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });

    const result = await t.mutation(internal.agentTasks.beginWorkerRun, {
      businessId,
      taskId: task!._id,
    });
    expect(result?.status).toBe("in_progress");

    const events = await t.query(internal.agentEvents.listByTask, { businessId, taskId: task!._id });
    const statusChange = events.find(
      (e) => e.event.kind === "status_change" && e.event.toStatus === "in_progress",
    );
    expect(statusChange?.actor).toBe("system");
  });

  it("beginWorkerRun is a no-op-safe guard: a second concurrent claim on the same task rejects instead of double-running it", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "worker-begin-b");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "worker-begin-b:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });

    await t.mutation(internal.agentTasks.beginWorkerRun, { businessId, taskId: task!._id });

    await expect(
      t.mutation(internal.agentTasks.beginWorkerRun, { businessId, taskId: task!._id }),
    ).rejects.toThrow("invalid_transition");
  });

  it("completeWorkerRun advances in_progress -> needs_review and always logs actor worker", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "worker-complete-a");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "worker-complete-a:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });
    await t.mutation(internal.agentTasks.beginWorkerRun, { businessId, taskId: task!._id });

    const result = await t.mutation(internal.agentTasks.completeWorkerRun, {
      businessId,
      taskId: task!._id,
    });
    expect(result?.status).toBe("needs_review");

    const events = await t.query(internal.agentEvents.listByTask, { businessId, taskId: task!._id });
    const statusChange = events.find(
      (e) => e.event.kind === "status_change" && e.event.toStatus === "needs_review",
    );
    expect(statusChange?.actor).toBe("worker");
  });

  it("completeWorkerRun cannot be used to reach done — there is no worker-loop path past needs_review", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "worker-complete-b");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "worker-complete-b:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });
    await t.mutation(internal.agentTasks.beginWorkerRun, { businessId, taskId: task!._id });
    await t.mutation(internal.agentTasks.completeWorkerRun, { businessId, taskId: task!._id });

    // completeWorkerRun only ever attempts in_progress -> needs_review; a
    // second call against a task already at needs_review is rejected by the
    // same transition table advanceStatus uses, not a special case.
    await expect(
      t.mutation(internal.agentTasks.completeWorkerRun, { businessId, taskId: task!._id }),
    ).rejects.toThrow("invalid_transition");
  });

  it("beginWorkerRun/completeWorkerRun respect the circuit breaker like advanceStatus does", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "worker-circuit-a");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Flaky task",
      description: "...",
      workerType: "coding",
      dispatchKey: "worker-circuit-a:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
      maxAttempts: 1,
    });
    await t.mutation(internal.agentTasks.recordAttemptFailure, {
      businessId,
      taskId: task!._id,
      errorMessage: "boom",
    });

    await expect(
      t.mutation(internal.agentTasks.beginWorkerRun, { businessId, taskId: task!._id }),
    ).rejects.toThrow("task_circuit_broken");
  });
});

describe("agentTasks: destructive tool call approval gate (THI-66)", () => {
  // resolveToolApproval's "approved" branch schedules
  // internal.workerRunner.resumeWorkerTask via ctx.scheduler.runAfter(0, …).
  // convex-test only runs scheduled functions on real wall-clock timers
  // unless fake timers are active (see its own TestConvexForDataModel
  // doc comment) — without this, that 0ms timer can fire later, against a
  // since-torn-down test backend, and crash an unrelated later test with a
  // "write outside of transaction" error. Fake timers keep it inert for
  // these tests, which only assert resolveToolApproval's own direct
  // effects, not resumeWorkerTask's (untestable here anyway — it's a "use
  // node" action needing real E2B/LLM credentials, same boundary
  // dispatcher.test.ts draws around runWorkerTask).
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function makeInProgressTask(t: ReturnType<typeof convexTest>, slug: string) {
    const businessId = await makeBusiness(t, slug);
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: `${slug}:task-1`,
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });
    await t.mutation(internal.agentTasks.beginWorkerRun, { businessId, taskId: task!._id });
    return { businessId, taskId: task!._id };
  }

  it("requestToolApproval sets pendingApproval without changing status", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeInProgressTask(t, "approval-request-a");

    const result = await t.mutation(internal.agentTasks.requestToolApproval, {
      businessId,
      taskId,
      toolName: "run_shell",
      argsSummary: '{"command":"rm -rf /tmp/x"}',
    });

    expect(result?.status).toBe("in_progress");
    expect(result?.pendingApproval?.toolName).toBe("run_shell");
    expect(result?.pendingApproval?.argsSummary).toBe('{"command":"rm -rf /tmp/x"}');
  });

  it("requestToolApproval rejects a task that is not in_progress", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "approval-request-b");
    const task = await t.mutation(internal.agentTasks.dispatch, {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding",
      dispatchKey: "approval-request-b:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
    });

    await expect(
      t.mutation(internal.agentTasks.requestToolApproval, {
        businessId,
        taskId: task!._id,
        toolName: "run_shell",
        argsSummary: "{}",
      }),
    ).rejects.toThrow("invalid_pending_approval_status:todo");
  });

  it("resolveToolApproval throws when there is nothing pending", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeInProgressTask(t, "approval-none-a");

    await expect(
      t.mutation(internal.agentTasks.resolveToolApproval, {
        businessId,
        taskId,
        actor: "owner",
        decision: "approved",
      }),
    ).rejects.toThrow("no_pending_approval");
  });

  it("approving clears pendingApproval, logs a typed decision event, and keeps the task in_progress", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeInProgressTask(t, "approval-approve-a");
    await t.mutation(internal.agentTasks.requestToolApproval, {
      businessId,
      taskId,
      toolName: "run_shell",
      argsSummary: '{"command":"npm publish"}',
    });

    const result = await t.mutation(internal.agentTasks.resolveToolApproval, {
      businessId,
      taskId,
      actor: "owner",
      decision: "approved",
    });

    expect(result?.status).toBe("in_progress");
    expect(result?.pendingApproval).toBeUndefined();

    const events = await t.query(internal.agentEvents.listByTask, { businessId, taskId });
    const decision = events.find((e) => e.event.kind === "tool_call_approval_decision");
    expect(decision?.actor).toBe("owner");
    expect(decision?.event.kind === "tool_call_approval_decision" && decision.event.decision).toBe(
      "approved",
    );
    expect(decision?.event.kind === "tool_call_approval_decision" && decision.event.toolName).toBe(
      "run_shell",
    );
  });

  it("denying clears pendingApproval, logs the decision, and moves the task to needs_review", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeInProgressTask(t, "approval-deny-a");
    await t.mutation(internal.agentTasks.requestToolApproval, {
      businessId,
      taskId,
      toolName: "run_shell",
      argsSummary: '{"command":"npm publish"}',
    });

    const result = await t.mutation(internal.agentTasks.resolveToolApproval, {
      businessId,
      taskId,
      actor: "ceo",
      decision: "denied",
    });

    expect(result?.status).toBe("needs_review");
    expect(result?.pendingApproval).toBeUndefined();

    const events = await t.query(internal.agentEvents.listByTask, { businessId, taskId });
    const decision = events.find((e) => e.event.kind === "tool_call_approval_decision");
    expect(decision?.event.kind === "tool_call_approval_decision" && decision.event.decision).toBe(
      "denied",
    );
    const statusChange = events.find(
      (e) => e.event.kind === "status_change" && e.event.toStatus === "needs_review",
    );
    expect(statusChange?.actor).toBe("ceo");
  });

  it("a retried resolveToolApproval call after the first one lands throws instead of double-deciding", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeInProgressTask(t, "approval-retry-a");
    await t.mutation(internal.agentTasks.requestToolApproval, {
      businessId,
      taskId,
      toolName: "run_shell",
      argsSummary: "{}",
    });
    await t.mutation(internal.agentTasks.resolveToolApproval, {
      businessId,
      taskId,
      actor: "owner",
      decision: "approved",
    });

    await expect(
      t.mutation(internal.agentTasks.resolveToolApproval, {
        businessId,
        taskId,
        actor: "owner",
        decision: "approved",
      }),
    ).rejects.toThrow("no_pending_approval");
  });
});
