import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";

// Fake Convex backend: mocks the wire boundary (`convex/browser`'s
// ConvexHttpClient) rather than the route's own logic, so GET/PATCH run for
// real against seeded businesses/api keys — this is what actually proves the
// REST layer's auth, envelope, tenancy, and idempotency behavior end to end.
const backend = vi.hoisted(() => {
  const businesses = new Map<string, any>();
  const apiKeys = new Map<string, any>();
  const idempotency = new Map<string, any>();
  const mutationCallCounts = new Map<string, number>();
  let counter = 0;

  function nextId(prefix: string) {
    counter += 1;
    return `${prefix}_${counter}`;
  }

  function reset() {
    businesses.clear();
    apiKeys.clear();
    idempotency.clear();
    mutationCallCounts.clear();
    counter = 0;
  }

  function seedBusiness(input: { name: string; slug: string }) {
    const id = nextId("business");
    businesses.set(id, {
      _id: id,
      name: input.name,
      slug: input.slug,
      lifecycleStatus: "active",
      checkoutReturnUrl: undefined,
    });
    return id;
  }

  function seedApiKey(input: { businessId: string; hashedKey: string; scopes: string[] }) {
    const id = nextId("apiKey");
    apiKeys.set(id, {
      _id: id,
      businessId: input.businessId,
      hashedKey: input.hashedKey,
      scopes: input.scopes,
      revokedAt: undefined,
    });
    return id;
  }

  function bump(name: string) {
    mutationCallCounts.set(name, (mutationCallCounts.get(name) ?? 0) + 1);
  }

  async function dispatch(name: string, args: any): Promise<any> {
    switch (name) {
      case "apiKeys:verifyByHash": {
        for (const key of apiKeys.values()) {
          if (key.hashedKey === args.hashedKey && !key.revokedAt) return key;
        }
        return null;
      }
      case "apiKeys:touchLastUsed":
        return null;
      case "businesses:getSelf":
        return businesses.get(args.businessId) ?? null;
      case "businesses:updateCheckoutReturnUrl": {
        bump("businesses:updateCheckoutReturnUrl");
        const b = businesses.get(args.businessId);
        if (!b) return null;
        b.checkoutReturnUrl = args.checkoutReturnUrl;
        return b;
      }
      case "idempotencyKeys:beginOrReplay": {
        const mapKey = `${args.businessId}|${args.route}|${args.key}`;
        for (const record of idempotency.values()) {
          if (record.mapKey === mapKey) {
            if (record.requestHash !== args.requestHash) return { outcome: "conflict" };
            if (record.status === "in_progress") return { outcome: "conflict" };
            return {
              outcome: "replay",
              responseStatus: record.responseStatus,
              responseBody: record.responseBody,
            };
          }
        }
        const id = nextId("idem");
        idempotency.set(id, { id, mapKey, requestHash: args.requestHash, status: "in_progress" });
        return { outcome: "began", id };
      }
      case "idempotencyKeys:complete": {
        const record = idempotency.get(args.id);
        if (record) {
          record.status = "completed";
          record.responseStatus = args.responseStatus;
          record.responseBody = args.responseBody;
        }
        return null;
      }
      default:
        throw new Error(`Unhandled fake Convex function in test: ${name}`);
    }
  }

  return { businesses, apiKeys, idempotency, mutationCallCounts, reset, seedBusiness, seedApiKey, dispatch };
});

vi.mock("convex/browser", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    ConvexHttpClient: class {
      constructor(_url: string) {}
      async query(fnRef: unknown, args: unknown) {
        return backend.dispatch(getFunctionName(fnRef as never), args);
      }
      async mutation(fnRef: unknown, args: unknown) {
        return backend.dispatch(getFunctionName(fnRef as never), args);
      }
    },
  };
});

const { GET, PATCH } = await import("./route");

const RAW_KEY_A = "tm_test_business_a_secret";
const RAW_KEY_B = "tm_test_business_b_secret";
const RAW_KEY_READONLY = "tm_test_readonly_secret";

async function seedTwoBusinesses() {
  const businessAId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
  const businessBId = backend.seedBusiness({ name: "Beta Co", slug: "beta" });

  await backend.seedApiKey({
    businessId: businessAId,
    hashedKey: await hashApiKey(RAW_KEY_A),
    scopes: ["read", "write"],
  });
  await backend.seedApiKey({
    businessId: businessBId,
    hashedKey: await hashApiKey(RAW_KEY_B),
    scopes: ["read", "write"],
  });
  await backend.seedApiKey({
    businessId: businessAId,
    hashedKey: await hashApiKey(RAW_KEY_READONLY),
    scopes: ["read"],
  });

  return { businessAId, businessBId };
}

function getRequest(bearer?: string) {
  return new Request("https://api.thismade.internal/v1/business", {
    method: "GET",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

function patchRequest(opts: {
  bearer?: string;
  idempotencyKey?: string;
  body?: unknown;
}) {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  headers["content-type"] = "application/json";
  return new Request("https://api.thismade.internal/v1/business", {
    method: "PATCH",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

beforeEach(() => {
  backend.reset();
});

describe("GET /v1/business", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("unauthorized");
    expect(body.error.docs_url).toContain("unauthorized");
  });

  it("returns unauthorized for a key that doesn't exist", async () => {
    await seedTwoBusinesses();
    const res = await GET(getRequest("tm_test_does_not_exist"));
    expect(res.status).toBe(401);
  });

  it("returns the caller's own business in the {data,hint,next_action} envelope", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const res = await GET(getRequest(RAW_KEY_A));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("data");
    expect(body).toHaveProperty("hint");
    expect(body).toHaveProperty("next_action");
    expect(body.data.id).toBe(businessAId);
    expect(body.data.slug).toBe("alpha");
  });

  it("never leaks another business's data: A's key gets A, B's key gets B", async () => {
    const { businessAId, businessBId } = await seedTwoBusinesses();

    const resA = await GET(getRequest(RAW_KEY_A));
    const bodyA = await resA.json();
    const resB = await GET(getRequest(RAW_KEY_B));
    const bodyB = await resB.json();

    expect(bodyA.data.id).toBe(businessAId);
    expect(bodyB.data.id).toBe(businessBId);
    expect(bodyA.data.id).not.toBe(bodyB.data.id);
    expect(bodyA.data.slug).toBe("alpha");
    expect(bodyB.data.slug).toBe("beta");
  });

  it("returns not_found (404), never forbidden (403), when the key's business no longer resolves", async () => {
    const orphanBusinessId = backend.seedBusiness({ name: "Orphan", slug: "orphan" });
    await backend.seedApiKey({
      businessId: orphanBusinessId,
      hashedKey: await hashApiKey("tm_test_orphan_secret"),
      scopes: ["read"],
    });
    backend.businesses.delete(orphanBusinessId); // simulate a cross-tenant/stale reference

    const res = await GET(getRequest("tm_test_orphan_secret"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });
});

describe("PATCH /v1/business", () => {
  it("requires an Idempotency-Key header", async () => {
    const { } = await seedTwoBusinesses();
    const res = await PATCH(
      patchRequest({ bearer: RAW_KEY_A, body: { checkoutReturnUrl: "https://alpha.example/return" } }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("requires the write scope", async () => {
    await seedTwoBusinesses();
    const res = await PATCH(
      patchRequest({
        bearer: RAW_KEY_READONLY,
        idempotencyKey: "req-1",
        body: { checkoutReturnUrl: "https://alpha.example/return" },
      }),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden_scope");
  });

  it("applies the update once and returns it in the envelope", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const res = await PATCH(
      patchRequest({
        bearer: RAW_KEY_A,
        idempotencyKey: "req-1",
        body: { checkoutReturnUrl: "https://alpha.example/return" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(businessAId);
    expect(body.data.checkoutReturnUrl).toBe("https://alpha.example/return");
    expect(backend.mutationCallCounts.get("businesses:updateCheckoutReturnUrl")).toBe(1);
  });

  it("replays the exact cached response on a duplicate request instead of mutating again", async () => {
    await seedTwoBusinesses();
    const body = { checkoutReturnUrl: "https://alpha.example/return" };

    const first = await PATCH(patchRequest({ bearer: RAW_KEY_A, idempotencyKey: "dup-key", body }));
    const firstBody = await first.json();
    expect(first.status).toBe(200);

    const second = await PATCH(patchRequest({ bearer: RAW_KEY_A, idempotencyKey: "dup-key", body }));
    const secondBody = await second.json();

    expect(second.status).toBe(200);
    expect(secondBody).toEqual(firstBody);
    // The underlying mutation must have run exactly once across both requests.
    expect(backend.mutationCallCounts.get("businesses:updateCheckoutReturnUrl")).toBe(1);
  });

  it("rejects reusing the same Idempotency-Key with a different body", async () => {
    await seedTwoBusinesses();
    const first = await PATCH(
      patchRequest({
        bearer: RAW_KEY_A,
        idempotencyKey: "conflict-key",
        body: { checkoutReturnUrl: "https://alpha.example/return-1" },
      }),
    );
    expect(first.status).toBe(200);

    const second = await PATCH(
      patchRequest({
        bearer: RAW_KEY_A,
        idempotencyKey: "conflict-key",
        body: { checkoutReturnUrl: "https://alpha.example/return-2" },
      }),
    );
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe("idempotency_conflict");
    // Only the first request's mutation should have applied.
    expect(backend.mutationCallCounts.get("businesses:updateCheckoutReturnUrl")).toBe(1);
  });

  it("scopes the Idempotency-Key per business, so two businesses can reuse the same key value independently", async () => {
    await seedTwoBusinesses();
    const resA = await PATCH(
      patchRequest({
        bearer: RAW_KEY_A,
        idempotencyKey: "same-key",
        body: { checkoutReturnUrl: "https://alpha.example/return" },
      }),
    );
    const resB = await PATCH(
      patchRequest({
        bearer: RAW_KEY_B,
        idempotencyKey: "same-key",
        body: { checkoutReturnUrl: "https://beta.example/return" },
      }),
    );
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(backend.mutationCallCounts.get("businesses:updateCheckoutReturnUrl")).toBe(2);
  });
});
