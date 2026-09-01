import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
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

    await t.mutation(api.agentEvents.sendChatMessage, {
      businessId,
      authorRole: "owner",
      text: "Ship the storefront checkout flow first.",
    });
    await t.mutation(api.agentEvents.sendChatMessage, {
      businessId,
      authorRole: "ceo",
      text: "On it — dispatching the coding worker now.",
    });

    const events = await t.query(api.agentEvents.listByBusiness, { businessId });
    expect(events).toHaveLength(2);
    expect(events[0].event.kind).toBe("chat_message");
    expect(events[0].actor).toBe("owner");
    expect(events[1].actor).toBe("ceo");
  });

  it("keeps chat events scoped to their own business", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await makeBusiness(t, "chat-tenancy-a");
    const businessBId = await makeBusiness(t, "chat-tenancy-b");

    await t.mutation(api.agentEvents.sendChatMessage, {
      businessId: businessAId,
      authorRole: "owner",
      text: "A's message",
    });

    expect(await t.query(api.agentEvents.listByBusiness, { businessId: businessAId })).toHaveLength(1);
    expect(await t.query(api.agentEvents.listByBusiness, { businessId: businessBId })).toHaveLength(0);
  });
});
