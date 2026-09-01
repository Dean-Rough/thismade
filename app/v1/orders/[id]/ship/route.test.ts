import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
process.env.CONVEX_SERVICE_SECRET = "test-secret";

// Fake Convex backend: mocks the wire boundary (`convex/browser`'s
// ConvexHttpClient) rather than the route's own logic — same approach as
// app/v1/products/[id]/route.test.ts.
const backend = vi.hoisted(() => {
  const businesses = new Map<string, any>();
  const apiKeys = new Map<string, any>();
  const orders = new Map<string, any>();
  const idempotency = new Map<string, any>();
  let counter = 0;

  function nextId(prefix: string) {
    counter += 1;
    return `${prefix}_${counter}`;
  }

  function reset() {
    businesses.clear();
    apiKeys.clear();
    orders.clear();
    idempotency.clear();
    counter = 0;
  }

  function seedBusiness(input: { name: string; slug: string }) {
    const id = nextId("business");
    businesses.set(id, { _id: id, name: input.name, slug: input.slug });
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

  function seedOrder(input: {
    businessId: string;
    productId?: string;
    customerEmail?: string;
    amountCents?: number;
    currency?: string;
    status?: "paid" | "refunded";
    shippedAt?: number;
  }) {
    const id = nextId("order");
    orders.set(id, {
      _id: id,
      businessId: input.businessId,
      productId: input.productId ?? "product_1",
      customerEmail: input.customerEmail ?? "buyer@example.com",
      amountCents: input.amountCents ?? 1500,
      currency: input.currency ?? "usd",
      status: input.status ?? "paid",
      shippedAt: input.shippedAt,
      shippingTrackingCode: undefined,
      refundedAt: undefined,
      stripeCheckoutSessionId: `cs_test_${id}`,
      createdAt: 1700000000000,
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
      case "ordersActions:getScopedById": {
        const doc = orders.get(args.orderId);
        if (!doc || doc.businessId !== args.businessId) return null;
        return doc;
      }
      case "ordersActions:markShipped": {
        const doc = orders.get(args.orderId);
        if (!doc || doc.businessId !== args.businessId) return null;
        doc.shippedAt = args.shippedAt;
        doc.shippingTrackingCode = args.trackingCode;
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

  return { businesses, apiKeys, orders, idempotency, reset, seedBusiness, seedApiKey, seedOrder, dispatch };
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

const { POST } = await import("./route");

const RAW_KEY_A = "tm_test_business_a_secret";
const RAW_KEY_B = "tm_test_business_b_secret";
const RAW_KEY_READONLY = "tm_test_readonly_secret";

async function seedBusinesses() {
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

function postRequest(id: string, opts: { bearer?: string; idempotencyKey?: string; body?: unknown }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new Request(`https://api.thismade.internal/v1/orders/${id}/ship`, {
    method: "POST",
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

describe("POST /v1/orders/{id}/ship", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await POST(postRequest("whatever", {}), ctx("whatever"));
    expect(res.status).toBe(401);
  });

  it("requires the write scope", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_READONLY, idempotencyKey: "req-1", body: { trackingCode: "1Z" } }),
      ctx(orderId),
    );
    expect(res.status).toBe(403);
  });

  it("requires an Idempotency-Key header", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_A, body: { trackingCode: "1Z" } }),
      ctx(orderId),
    );
    expect(res.status).toBe(400);
  });

  it("rejects a missing/empty trackingCode", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_A, idempotencyKey: "req-1", body: {} }),
      ctx(orderId),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("returns not_found (404), never forbidden (403), for a cross-tenant id", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_B, idempotencyKey: "req-1", body: { trackingCode: "1Z" } }),
      ctx(orderId),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(backend.orders.get(orderId).shippedAt).toBeUndefined();
  });

  it("marks an order shipped with the given tracking code", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_A, idempotencyKey: "req-1", body: { trackingCode: "1Z999AA1" } }),
      ctx(orderId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.shippingTrackingCode).toBe("1Z999AA1");
    expect(body.data.shippedAt).not.toBeNull();
  });

  it("rejects a double-ship", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId, shippedAt: 1700000001000 });

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_A, idempotencyKey: "req-1", body: { trackingCode: "1Z" } }),
      ctx(orderId),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("allows shipping an already-refunded order — shippedAt/refundedAt are independent facts", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId, status: "refunded" });

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_A, idempotencyKey: "req-1", body: { trackingCode: "1Z" } }),
      ctx(orderId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("refunded");
    expect(body.data.shippingTrackingCode).toBe("1Z");
  });

  it("replays the cached response on a duplicate Idempotency-Key instead of shipping twice", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });

    const body = { trackingCode: "1Z999" };
    const first = await POST(
      postRequest(orderId, { bearer: RAW_KEY_A, idempotencyKey: "dup-key", body }),
      ctx(orderId),
    );
    const firstBody = await first.json();

    const second = await POST(
      postRequest(orderId, { bearer: RAW_KEY_A, idempotencyKey: "dup-key", body }),
      ctx(orderId),
    );
    const secondBody = await second.json();

    expect(secondBody).toEqual(firstBody);
  });
});
