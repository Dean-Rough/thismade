import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

describe("idempotencyKeys.beginOrReplay", () => {
  it("claims a fresh key, then replays the completed response on a duplicate request", async () => {
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "idem-a",
      ownerUserId: "user_a",
    });

    const first = await t.mutation(internal.idempotencyKeys.beginOrReplay, {
      businessId,
      route: "PATCH /v1/business",
      key: "req-123",
      requestHash: "hash-of-body",
    });
    expect(first.outcome).toBe("began");
    if (first.outcome !== "began") throw new Error("unreachable");

    await t.mutation(internal.idempotencyKeys.complete, {
      id: first.id,
      responseStatus: 200,
      responseBody: JSON.stringify({ data: { ok: true }, hint: null, next_action: null }),
    });

    // A duplicate request — same business, route, key, and body — must replay
    // the exact original response instead of re-running the mutation.
    const duplicate = await t.mutation(internal.idempotencyKeys.beginOrReplay, {
      businessId,
      route: "PATCH /v1/business",
      key: "req-123",
      requestHash: "hash-of-body",
    });
    expect(duplicate.outcome).toBe("replay");
    if (duplicate.outcome !== "replay") throw new Error("unreachable");
    expect(duplicate.responseStatus).toBe(200);
    expect(JSON.parse(duplicate.responseBody)).toEqual({
      data: { ok: true },
      hint: null,
      next_action: null,
    });
  });

  it("rejects the same key reused with a different request body", async () => {
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "idem-b",
      ownerUserId: "user_a",
    });

    const first = await t.mutation(internal.idempotencyKeys.beginOrReplay, {
      businessId,
      route: "PATCH /v1/business",
      key: "req-456",
      requestHash: "hash-of-body-v1",
    });
    if (first.outcome !== "began") throw new Error("unreachable");
    await t.mutation(internal.idempotencyKeys.complete, {
      id: first.id,
      responseStatus: 200,
      responseBody: "{}",
    });

    const reused = await t.mutation(internal.idempotencyKeys.beginOrReplay, {
      businessId,
      route: "PATCH /v1/business",
      key: "req-456",
      requestHash: "hash-of-different-body",
    });
    expect(reused.outcome).toBe("conflict");
  });

  it("rejects a concurrent request that reuses a key still in progress", async () => {
    const t = convexTest(schema, modules);
    const businessId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "idem-c",
      ownerUserId: "user_a",
    });

    const first = await t.mutation(internal.idempotencyKeys.beginOrReplay, {
      businessId,
      route: "PATCH /v1/business",
      key: "req-789",
      requestHash: "hash-of-body",
    });
    expect(first.outcome).toBe("began");

    // No `complete` call yet — simulates a second request racing in while the
    // first is still executing.
    const concurrent = await t.mutation(internal.idempotencyKeys.beginOrReplay, {
      businessId,
      route: "PATCH /v1/business",
      key: "req-789",
      requestHash: "hash-of-body",
    });
    expect(concurrent.outcome).toBe("conflict");
  });

  it("scopes keys per business + route, so the same key string is independent across businesses", async () => {
    const t = convexTest(schema, modules);
    const businessAId = await t.mutation(internal.businesses.create, {
      name: "Business A",
      slug: "idem-d-a",
      ownerUserId: "user_a",
    });
    const businessBId = await t.mutation(internal.businesses.create, {
      name: "Business B",
      slug: "idem-d-b",
      ownerUserId: "user_b",
    });

    const forA = await t.mutation(internal.idempotencyKeys.beginOrReplay, {
      businessId: businessAId,
      route: "PATCH /v1/business",
      key: "shared-key",
      requestHash: "hash",
    });
    const forB = await t.mutation(internal.idempotencyKeys.beginOrReplay, {
      businessId: businessBId,
      route: "PATCH /v1/business",
      key: "shared-key",
      requestHash: "hash",
    });

    expect(forA.outcome).toBe("began");
    expect(forB.outcome).toBe("began");
  });
});
