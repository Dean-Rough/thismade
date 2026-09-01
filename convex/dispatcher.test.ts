import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SECRET = "dispatcher-test-secret";

async function makeBusiness(t: ReturnType<typeof convexTest>, slug: string) {
  const businessId = await t.mutation(internal.businesses.create, {
    name: `Business ${slug}`,
    slug,
    ownerUserId: `user_${slug}`,
  });
  await t.mutation(internal.creditLedger.grant, { businessId, amount: 1000, reason: "test fixture grant" });
  return businessId;
}

// convex-test does not auto-execute scheduled functions (scheduling one is a
// mutation-safe side effect that just enqueues it — see
// finishAllScheduledFunctions in convex-test's own types) — these tests
// exercise runTask's dispatch + scheduling logic without ever invoking
// convex/workerRunner.ts's real "use node" action, so no E2B/LLM credential
// is needed to test this file. Live worker execution is not covered here;
// see the THI-68 plan document's test-strategy section.
describe("dispatcher: runTask (THI-68)", () => {
  afterEach(() => {
    delete process.env.CONVEX_SERVICE_SECRET;
  });

  it("rejects a call with the wrong service secret and creates no task", async () => {
    process.env.CONVEX_SERVICE_SECRET = SECRET;
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "dispatcher-auth");

    await expect(
      t.action(api.dispatcher.runTask, {
        businessId,
        title: "Task",
        description: "...",
        workerType: "coding",
        dispatchKey: "dispatcher-auth:task-1",
        instructions: "...",
        containsUntrustedContent: false,
        creditCost: 10,
        secret: "wrong-secret",
      }),
    ).rejects.toThrow();

    expect(await t.query(internal.agentTasks.listByBusiness, { businessId })).toHaveLength(0);
  });

  it("creates the dispatched task via the existing dispatch mutation", async () => {
    process.env.CONVEX_SERVICE_SECRET = SECRET;
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "dispatcher-create");

    const task = await t.action(api.dispatcher.runTask, {
      businessId,
      title: "Mirror catalog products",
      description: "Sync product names.",
      workerType: "coding",
      dispatchKey: "dispatcher-create:task-1",
      instructions: "Call productsInternal:getByPlatformProductId ...",
      containsUntrustedContent: false,
      creditCost: 10,
      secret: SECRET,
    });

    expect(task?.status).toBe("todo");
    expect(task?.title).toBe("Mirror catalog products");

    const all = await t.query(internal.agentTasks.listByBusiness, { businessId });
    expect(all).toHaveLength(1);
  });

  it("replays the same task on a repeated dispatchKey instead of creating a duplicate or double-scheduling", async () => {
    process.env.CONVEX_SERVICE_SECRET = SECRET;
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "dispatcher-idempotent");

    const args = {
      businessId,
      title: "Task",
      description: "...",
      workerType: "coding" as const,
      dispatchKey: "dispatcher-idempotent:task-1",
      instructions: "...",
      containsUntrustedContent: false,
      creditCost: 10,
      secret: SECRET,
    };

    const first = await t.action(api.dispatcher.runTask, args);
    const second = await t.action(api.dispatcher.runTask, args);

    expect(second?._id).toBe(first?._id);
    const all = await t.query(internal.agentTasks.listByBusiness, { businessId });
    expect(all).toHaveLength(1);
    // Credit spend is keyed off dispatch's own idempotencyKey, unaffected by
    // how many times runTask itself is called on the same dispatchKey.
    expect(await t.query(internal.creditLedger.getBalance, { businessId })).toBe(1000 - 10);
  });
});
