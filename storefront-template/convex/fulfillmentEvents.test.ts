import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("fulfillmentEvents.record: replay dedup", () => {
  it("does not insert a second row when the same externalOrderId is replayed", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.fulfillmentEvents.record, {
      externalOrderId: "order_replay_test",
      payload: JSON.stringify({ externalOrderId: "order_replay_test", status: "shipped" }),
    });
    await t.mutation(api.fulfillmentEvents.record, {
      externalOrderId: "order_replay_test",
      payload: JSON.stringify({ externalOrderId: "order_replay_test", status: "shipped" }),
    });

    const rows = await t.query(api.fulfillmentEvents.list, {});
    expect(rows.filter((r) => r.externalOrderId === "order_replay_test")).toHaveLength(1);
  });

  it("returns the existing row's id on replay instead of a new id", async () => {
    const t = convexTest(schema, modules);

    const firstId = await t.mutation(api.fulfillmentEvents.record, {
      externalOrderId: "order_replay_id_test",
      payload: "{}",
    });
    const secondId = await t.mutation(api.fulfillmentEvents.record, {
      externalOrderId: "order_replay_id_test",
      payload: "{}",
    });

    expect(secondId).toBe(firstId);
  });

  it("still inserts separate rows for distinct externalOrderIds", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.fulfillmentEvents.record, {
      externalOrderId: "order_a",
      payload: "{}",
    });
    await t.mutation(api.fulfillmentEvents.record, {
      externalOrderId: "order_b",
      payload: "{}",
    });

    const rows = await t.query(api.fulfillmentEvents.list, {});
    expect(rows.map((r) => r.externalOrderId).sort()).toEqual(["order_a", "order_b"]);
  });
});
