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

describe("agentEvents: chat", () => {
  it("logs a chat_message event for owner and ceo authors, readable via listByBusiness", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "chat-a");

    await t.mutation(internal.agentEvents.sendChatMessage, {
      businessId,
      authorRole: "owner",
      text: "Ship the storefront checkout flow first.",
    });
    await t.mutation(internal.agentEvents.sendChatMessage, {
      businessId,
      authorRole: "ceo",
      text: "On it — dispatching the coding worker now.",
    });

    const events = await t.query(internal.agentEvents.listByBusiness, { businessId });
    expect(events).toHaveLength(2);
    expect(events[0].event.kind).toBe("chat_message");
    expect(events[0].actor).toBe("owner");
    expect(events[1].actor).toBe("ceo");
  });

  it("keeps chat events scoped to their own business", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await makeBusiness(t, "chat-tenancy-a");
    const businessBId = await makeBusiness(t, "chat-tenancy-b");

    await t.mutation(internal.agentEvents.sendChatMessage, {
      businessId: businessAId,
      authorRole: "owner",
      text: "A's message",
    });

    expect(await t.query(internal.agentEvents.listByBusiness, { businessId: businessAId })).toHaveLength(1);
    expect(await t.query(internal.agentEvents.listByBusiness, { businessId: businessBId })).toHaveLength(0);
  });
});

describe("agentEvents: logWorkerEvent (THI-68 identity boundary)", () => {
  async function makeTask(t: ReturnType<typeof convexTest>, slug: string) {
    const businessId = await makeBusiness(t, slug);
    await t.mutation(internal.creditLedger.grant, { businessId, amount: 100, reason: "test fixture" });
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
    return { businessId, taskId: task!._id };
  }

  it("logs a tool_call event with actor worker", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeTask(t, "worker-event-tool-call");

    await t.mutation(internal.agentEvents.logWorkerEvent, {
      businessId,
      taskId,
      actor: "worker",
      event: { kind: "tool_call", taskId, toolName: "run_shell", argsSummary: '{"command":"ls"}' },
    });

    const events = await t.query(internal.agentEvents.listByTask, { businessId, taskId });
    const toolCall = events.find((e) => e.event.kind === "tool_call");
    expect(toolCall?.actor).toBe("worker");
  });

  it("logs a system-actor error event", async () => {
    const t = convexTest(schema, modules);
    const { businessId, taskId } = await makeTask(t, "worker-event-error");

    await t.mutation(internal.agentEvents.logWorkerEvent, {
      businessId,
      taskId,
      actor: "system",
      event: { kind: "error", taskId, message: "e2b_api_key_not_configured" },
    });

    const events = await t.query(internal.agentEvents.listByTask, { businessId, taskId });
    const errorEvent = events.find((e) => e.event.kind === "error");
    expect(errorEvent?.actor).toBe("system");
  });

  it("rejects logging against a task from a different business", async () => {
    const t = convexTest(schema, modules);
    const { taskId } = await makeTask(t, "worker-event-tenancy-a");
    const otherBusinessId = await makeBusiness(t, "worker-event-tenancy-b");

    await expect(
      t.mutation(internal.agentEvents.logWorkerEvent, {
        businessId: otherBusinessId,
        taskId,
        actor: "worker",
        event: { kind: "error", taskId, message: "should not land" },
      }),
    ).rejects.toThrow("task_not_found");
  });
});

describe("agentEvents: chat text hardening (THI-62)", () => {
  it("rejects an empty chat message", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "chat-hardening-empty");

    await expect(
      t.mutation(internal.agentEvents.sendChatMessage, {
        businessId,
        authorRole: "owner",
        text: "",
      }),
    ).rejects.toThrow("invalid_text_length");

    expect(await t.query(internal.agentEvents.listByBusiness, { businessId })).toHaveLength(0);
  });

  it("rejects a chat message over the length cap", async () => {
    const t = convexTest(schema, modules);
    const businessId = await makeBusiness(t, "chat-hardening-long");

    await expect(
      t.mutation(internal.agentEvents.sendChatMessage, {
        businessId,
        authorRole: "owner",
        text: "x".repeat(4_001),
      }),
    ).rejects.toThrow("invalid_text_length");

    expect(await t.query(internal.agentEvents.listByBusiness, { businessId })).toHaveLength(0);
  });
});
