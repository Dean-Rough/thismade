import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("fulfillmentEvents.record: replay dedup", () => {
  it("does not insert a second row when the same externalOrderId is replayed", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.fulfillmentEvents.record, {
      externalOrderId: "order_replay_test",
      payload: JSON.stringify({ externalOrderId: "order_replay_test", status: "shipped" }),
    });
    await t.mutation(internal.fulfillmentEvents.record, {
      externalOrderId: "order_replay_test",
      payload: JSON.stringify({ externalOrderId: "order_replay_test", status: "shipped" }),
    });

    const rows = await t.query(internal.fulfillmentEvents.list, {});
    expect(rows.filter((r) => r.externalOrderId === "order_replay_test")).toHaveLength(1);
  });

  it("returns the existing row's id on replay instead of a new id", async () => {
    const t = convexTest(schema, modules);

    const firstId = await t.mutation(internal.fulfillmentEvents.record, {
      externalOrderId: "order_replay_id_test",
      payload: "{}",
    });
    const secondId = await t.mutation(internal.fulfillmentEvents.record, {
      externalOrderId: "order_replay_id_test",
      payload: "{}",
    });

    expect(secondId).toBe(firstId);
  });

  it("still inserts separate rows for distinct externalOrderIds", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(internal.fulfillmentEvents.record, {
      externalOrderId: "order_a",
      payload: "{}",
    });
    await t.mutation(internal.fulfillmentEvents.record, {
      externalOrderId: "order_b",
      payload: "{}",
    });

    const rows = await t.query(internal.fulfillmentEvents.list, {});
    expect(rows.map((r) => r.externalOrderId).sort()).toEqual(["order_a", "order_b"]);
  });
});

// THI-53: record/list must not be reachable without the shared service
// secret. These tests exercise the actions as an external caller would —
// through `api.fulfillmentEventsActions`, never `internal.*` — since that's
// the only boundary this fix adds. Without it, anyone who read
// NEXT_PUBLIC_CONVEX_URL out of the storefront's public bundle could call
// fulfillmentEvents.record/list directly, bypassing both the POST
// /api/fulfillment HMAC boundary and the /admin JWT gate.
describe("fulfillmentEventsActions: service secret gate", () => {
  afterEach(() => {
    delete process.env.CONVEX_SERVICE_SECRET;
  });

  it("rejects record with no CONVEX_SERVICE_SECRET configured at all", async () => {
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.fulfillmentEventsActions.record, {
        externalOrderId: "order_unauth_unconfigured",
        payload: "{}",
        secret: "anything",
      }),
    ).rejects.toThrow();

    const rows = await t.query(internal.fulfillmentEvents.list, {});
    expect(rows.filter((r) => r.externalOrderId === "order_unauth_unconfigured")).toHaveLength(0);
  });

  it("rejects record with the wrong secret", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);

    await expect(
      t.action(api.fulfillmentEventsActions.record, {
        externalOrderId: "order_unauth_wrong",
        payload: "{}",
        secret: "wrong-secret",
      }),
    ).rejects.toThrow();

    const rows = await t.query(internal.fulfillmentEvents.list, {});
    expect(rows.filter((r) => r.externalOrderId === "order_unauth_wrong")).toHaveLength(0);
  });

  it("rejects list with a missing or wrong secret", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);
    await t.mutation(internal.fulfillmentEvents.record, {
      externalOrderId: "order_list_gate",
      payload: "{}",
    });

    await expect(t.action(api.fulfillmentEventsActions.list, { secret: "" })).rejects.toThrow();
    await expect(
      t.action(api.fulfillmentEventsActions.list, { secret: "wrong-secret" }),
    ).rejects.toThrow();
  });

  it("delegates to the internal functions once the correct secret is supplied", async () => {
    process.env.CONVEX_SERVICE_SECRET = "correct-secret";
    const t = convexTest(schema, modules);

    const id = await t.action(api.fulfillmentEventsActions.record, {
      externalOrderId: "order_authorized",
      payload: "{}",
      secret: "correct-secret",
    });
    expect(id).toBeTruthy();

    const rows = await t.action(api.fulfillmentEventsActions.list, { secret: "correct-secret" });
    expect(rows.map((r) => r.externalOrderId)).toContain("order_authorized");
  });
});
