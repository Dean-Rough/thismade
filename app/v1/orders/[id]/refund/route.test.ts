import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
process.env.CONVEX_SERVICE_SECRET = "test-secret";

const ORIGINAL_STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

// Fake Convex backend: mocks the wire boundary (`convex/browser`'s
// ConvexHttpClient) rather than the route's own logic — same approach as
// app/v1/products/[id]/route.test.ts and app/v1/payouts/onboarding-link/route.test.ts.
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
    stripeCheckoutSessionId?: string;
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
      shippedAt: undefined,
      shippingTrackingCode: undefined,
      refundedAt: undefined,
      stripeCheckoutSessionId: input.stripeCheckoutSessionId ?? `cs_test_${id}`,
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
      case "ordersActions:markRefunded": {
        const doc = orders.get(args.orderId);
        if (!doc || doc.businessId !== args.businessId) return null;
        doc.status = "refunded";
        doc.refundedAt = args.refundedAt;
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

const RAW_KEY_MONEY = "tm_test_money_secret";
const RAW_KEY_B = "tm_test_business_b_secret";
const RAW_KEY_READONLY = "tm_test_readonly_secret";

function fakeStripeFetch(opts: { paymentIntent?: string | null } = {}) {
  return vi.fn(async (url: string) => {
    if (url.startsWith("https://api.stripe.com/v1/checkout/sessions/")) {
      return new Response(
        JSON.stringify({ payment_intent: opts.paymentIntent ?? "pi_test_abc" }),
        { status: 200 },
      );
    }
    if (url === "https://api.stripe.com/v1/refunds") {
      return new Response(JSON.stringify({ id: "re_test_1", status: "succeeded" }), { status: 200 });
    }
    throw new Error(`Unexpected Stripe URL: ${url}`);
  });
}

async function seedBusinesses() {
  const businessAId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
  const businessBId = backend.seedBusiness({ name: "Beta Co", slug: "beta" });

  await backend.seedApiKey({
    businessId: businessAId,
    hashedKey: await hashApiKey(RAW_KEY_MONEY),
    scopes: ["read", "write", "money"],
  });
  await backend.seedApiKey({
    businessId: businessBId,
    hashedKey: await hashApiKey(RAW_KEY_B),
    scopes: ["read", "write", "money"],
  });
  await backend.seedApiKey({
    businessId: businessAId,
    hashedKey: await hashApiKey(RAW_KEY_READONLY),
    scopes: ["read"],
  });

  return { businessAId, businessBId };
}

function postRequest(id: string, opts: { bearer?: string; idempotencyKey?: string }) {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new Request(`https://api.thismade.internal/v1/orders/${id}/refund`, {
    method: "POST",
    headers,
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  backend.reset();
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
});

afterEach(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_KEY;
  vi.unstubAllGlobals();
});

describe("POST /v1/orders/{id}/refund", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await POST(postRequest("whatever", {}), ctx("whatever"));
    expect(res.status).toBe(401);
  });

  it("requires the money scope", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_READONLY, idempotencyKey: "req-1" }),
      ctx(orderId),
    );
    expect(res.status).toBe(403);
  });

  it("requires an Idempotency-Key header", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });

    const res = await POST(postRequest(orderId, { bearer: RAW_KEY_MONEY }), ctx(orderId));
    expect(res.status).toBe(400);
  });

  it("returns not_found (404), never forbidden (403), for a cross-tenant id", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_B, idempotencyKey: "req-1" }),
      ctx(orderId),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
    expect(backend.orders.get(orderId).status).toBe("paid");
  });

  it("refunds a paid order via Stripe test mode and persists status/refundedAt", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId, stripeCheckoutSessionId: "cs_test_xyz" });
    const fetchMock = fakeStripeFetch();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_MONEY, idempotencyKey: "req-1" }),
      ctx(orderId),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("refunded");
    expect(body.data.refundedAt).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.stripe.com/v1/checkout/sessions/cs_test_xyz",
      expect.anything(),
    );
  });

  it("rejects a double-refund with refund_already_issued (409) without calling Stripe again", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId, status: "refunded" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_MONEY, idempotencyKey: "req-1" }),
      ctx(orderId),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("refund_already_issued");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("replays the cached response on a duplicate Idempotency-Key instead of refunding twice", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });
    const fetchMock = fakeStripeFetch();
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(
      postRequest(orderId, { bearer: RAW_KEY_MONEY, idempotencyKey: "dup-key" }),
      ctx(orderId),
    );
    const firstBody = await first.json();

    const second = await POST(
      postRequest(orderId, { bearer: RAW_KEY_MONEY, idempotencyKey: "dup-key" }),
      ctx(orderId),
    );
    const secondBody = await second.json();

    expect(secondBody).toEqual(firstBody);
    expect(fetchMock).toHaveBeenCalledTimes(2); // session lookup + refund, once only
  });

  it("returns idempotency_conflict (409) when the same key is reused with a mid-flight or differently-shaped request", async () => {
    const { businessAId } = await seedBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });
    backend.idempotency.set("preexisting", {
      id: "preexisting",
      mapKey: `${businessAId}|POST /v1/orders/:id/refund|dup-key`,
      requestHash: "some-other-hash",
      status: "completed",
      responseStatus: 200,
      responseBody: "{}",
    });

    const res = await POST(
      postRequest(orderId, { bearer: RAW_KEY_MONEY, idempotencyKey: "dup-key" }),
      ctx(orderId),
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("idempotency_conflict");
  });
});
