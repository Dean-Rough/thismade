import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
process.env.CONVEX_SERVICE_SECRET = "test-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";

// Fake Convex backend: mocks the wire boundary (`convex/browser`'s
// ConvexHttpClient) rather than the route's own logic — same approach as
// `app/v1/business/route.test.ts`.
const backend = vi.hoisted(() => {
  const businesses = new Map<string, any>();
  const apiKeys = new Map<string, any>();
  const products = new Map<string, any>();
  const idempotency = new Map<string, any>();
  let counter = 0;

  function nextId(prefix: string) {
    counter += 1;
    return `${prefix}_${counter}`;
  }

  function reset() {
    businesses.clear();
    apiKeys.clear();
    products.clear();
    idempotency.clear();
    counter = 0;
  }

  function seedBusiness(input: { name: string; slug: string }) {
    const id = nextId("business");
    businesses.set(id, { _id: id, name: input.name, slug: input.slug, lifecycleStatus: "active" });
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

  function seedProduct(input: {
    businessId: string;
    title?: string;
    description?: string;
    priceAmountCents?: number;
    currency?: string;
    status?: "active" | "draft" | "archived";
  }) {
    const id = nextId("product");
    products.set(id, {
      _id: id,
      businessId: input.businessId,
      title: input.title ?? "Mug",
      description: input.description ?? "A mug.",
      priceAmountCents: input.priceAmountCents ?? 1500,
      currency: input.currency ?? "usd",
      status: input.status ?? "draft",
      stripeProductId: undefined,
      stripePriceId: undefined,
      deliverableFileUrl: undefined,
    });
    return id;
  }

  async function dispatch(name: string, args: any): Promise<any> {
    switch (name) {
      case "apiKeysActions:verifyByHash": {
        for (const key of apiKeys.values()) {
          if (key.hashedKey === args.hashedKey && !key.revokedAt) return key;
        }
        return null;
      }
      case "apiKeysActions:touchLastUsed":
        return null;
      case "productsActions:getScopedById": {
        // Mirrors convex/lib/tenancy.ts: a malformed or cross-tenant id
        // both resolve to null, never a thrown error or another
        // business's row.
        const doc = products.get(args.productId);
        if (!doc || doc.businessId !== args.businessId) return null;
        return doc;
      }
      case "productsActions:update": {
        const doc = products.get(args.productId);
        if (!doc || doc.businessId !== args.businessId) return null;
        for (const field of [
          "title",
          "description",
          "priceAmountCents",
          "currency",
          "status",
          "deliverableFileUrl",
          "stripeProductId",
          "stripePriceId",
        ]) {
          if (args[field] !== undefined) doc[field] = args[field];
        }
        return doc;
      }
      case "idempotencyKeysActions:beginOrReplay": {
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
      case "idempotencyKeysActions:complete": {
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

  return {
    businesses,
    apiKeys,
    products,
    idempotency,
    reset,
    seedBusiness,
    seedApiKey,
    seedProduct,
    dispatch,
  };
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
      async action(fnRef: unknown, args: unknown) {
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

function getRequest(id: string, bearer?: string) {
  return new Request(`https://api.thismade.internal/v1/products/${id}`, {
    method: "GET",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

function patchRequest(id: string, opts: { bearer?: string; idempotencyKey?: string; body?: unknown }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new Request(`https://api.thismade.internal/v1/products/${id}`, {
    method: "PATCH",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  backend.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /v1/products/{id}", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await GET(getRequest("whatever"), ctx("whatever"));
    expect(res.status).toBe(401);
  });

  it("returns the product when it belongs to the caller's business", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId, title: "Mug" });

    const res = await GET(getRequest(productId, RAW_KEY_A), ctx(productId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(productId);
    expect(body.data.title).toBe("Mug");
  });

  it("returns not_found (404), never forbidden (403), for a cross-tenant id", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId });

    const res = await GET(getRequest(productId, RAW_KEY_B), ctx(productId));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("returns not_found for a malformed id instead of a 500", async () => {
    await seedTwoBusinesses();
    const res = await GET(getRequest("not-a-real-id", RAW_KEY_A), ctx("not-a-real-id"));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /v1/products/{id}", () => {
  it("requires an Idempotency-Key header", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId });
    const res = await PATCH(
      patchRequest(productId, { bearer: RAW_KEY_A, body: { title: "New title" } }),
      ctx(productId),
    );
    expect(res.status).toBe(400);
  });

  it("requires the write scope", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId });
    const res = await PATCH(
      patchRequest(productId, {
        bearer: RAW_KEY_READONLY,
        idempotencyKey: "req-1",
        body: { title: "New title" },
      }),
      ctx(productId),
    );
    expect(res.status).toBe(403);
  });

  it("returns not_found (404), never forbidden (403), when updating a cross-tenant id", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId });

    const res = await PATCH(
      patchRequest(productId, {
        bearer: RAW_KEY_B,
        idempotencyKey: "req-1",
        body: { title: "Hijacked" },
      }),
      ctx(productId),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(backend.products.get(productId).title).not.toBe("Hijacked");
  });

  it("patches title/description/price without touching status", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId });

    const res = await PATCH(
      patchRequest(productId, {
        bearer: RAW_KEY_A,
        idempotencyKey: "req-1",
        body: { title: "Renamed Mug", priceAmountCents: 2500 },
      }),
      ctx(productId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.title).toBe("Renamed Mug");
    expect(body.data.priceAmountCents).toBe(2500);
    expect(body.data.status).toBe("draft");
  });

  it("archives a product via status: archived", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId, status: "active" });

    const res = await PATCH(
      patchRequest(productId, {
        bearer: RAW_KEY_A,
        idempotencyKey: "req-1",
        body: { status: "archived" },
      }),
      ctx(productId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("archived");
  });

  it("rejects an invalid status value", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId });

    const res = await PATCH(
      patchRequest(productId, {
        bearer: RAW_KEY_A,
        idempotencyKey: "req-1",
        body: { status: "not-a-status" },
      }),
      ctx(productId),
    );
    expect(res.status).toBe(400);
  });

  it("syncs to Stripe test mode and stores the ids when status transitions to active", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({
      businessId: businessAId,
      title: "Mug",
      priceAmountCents: 1500,
      currency: "usd",
      status: "draft",
    });

    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/v1/products")) {
        return new Response(JSON.stringify({ id: "prod_test_abc" }), { status: 200 });
      }
      if (url.endsWith("/v1/prices")) {
        return new Response(JSON.stringify({ id: "price_test_abc" }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await PATCH(
      patchRequest(productId, {
        bearer: RAW_KEY_A,
        idempotencyKey: "req-1",
        body: { status: "active" },
      }),
      ctx(productId),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("active");
    expect(body.data.stripeProductId).toBe("prod_test_abc");
    expect(body.data.stripePriceId).toBe("price_test_abc");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not touch the stored product when Stripe sync fails on activation", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId, status: "draft" });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("card declined", { status: 402 })),
    );

    const res = await PATCH(
      patchRequest(productId, {
        bearer: RAW_KEY_A,
        idempotencyKey: "req-1",
        body: { status: "active" },
      }),
      ctx(productId),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("internal");
    expect(backend.products.get(productId).status).toBe("draft");
    expect(backend.products.get(productId).stripeProductId).toBeUndefined();
  });

  it("does not re-sync to Stripe when a product is already active", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId, status: "active" });
    backend.products.get(productId).stripeProductId = "prod_existing";
    backend.products.get(productId).stripePriceId = "price_existing";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await PATCH(
      patchRequest(productId, {
        bearer: RAW_KEY_A,
        idempotencyKey: "req-1",
        body: { title: "Still active" },
      }),
      ctx(productId),
    );

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.data.stripeProductId).toBe("prod_existing");
  });

  it("replays the cached response on a duplicate Idempotency-Key instead of re-syncing to Stripe", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const productId = backend.seedProduct({ businessId: businessAId, status: "draft" });

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/v1/products")) return new Response(JSON.stringify({ id: "prod_x" }), { status: 200 });
      return new Response(JSON.stringify({ id: "price_x" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const body = { status: "active" };
    const first = await PATCH(
      patchRequest(productId, { bearer: RAW_KEY_A, idempotencyKey: "dup", body }),
      ctx(productId),
    );
    const firstBody = await first.json();

    const second = await PATCH(
      patchRequest(productId, { bearer: RAW_KEY_A, idempotencyKey: "dup", body }),
      ctx(productId),
    );
    const secondBody = await second.json();

    expect(secondBody).toEqual(firstBody);
    expect(fetchMock).toHaveBeenCalledTimes(2); // only the first request hit Stripe
  });
});
