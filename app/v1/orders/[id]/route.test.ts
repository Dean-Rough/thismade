import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";

// Fake Convex backend: mocks the wire boundary (`convex/browser`'s
// ConvexHttpClient) rather than the route's own logic — same approach as
// app/v1/products/[id]/route.test.ts.
const backend = vi.hoisted(() => {
  const businesses = new Map<string, any>();
  const apiKeys = new Map<string, any>();
  const orders = new Map<string, any>();
  let counter = 0;

  function nextId(prefix: string) {
    counter += 1;
    return `${prefix}_${counter}`;
  }

  function reset() {
    businesses.clear();
    apiKeys.clear();
    orders.clear();
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
      stripeCheckoutSessionId: `cs_test_${id}`,
      createdAt: 1700000000000,
    });
    return id;
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
      case "orders:getScopedById": {
        // Mirrors convex/lib/tenancy.ts: a malformed or cross-tenant id both
        // resolve to null, never a thrown error or another business's row.
        const doc = orders.get(args.orderId);
        if (!doc || doc.businessId !== args.businessId) return null;
        return doc;
      }
      default:
        throw new Error(`Unhandled fake Convex function in test: ${name}`);
    }
  }

  return { businesses, apiKeys, orders, reset, seedBusiness, seedApiKey, seedOrder, dispatch };
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

const { GET } = await import("./route");

const RAW_KEY_A = "tm_test_business_a_secret";
const RAW_KEY_B = "tm_test_business_b_secret";

async function seedTwoBusinesses() {
  const businessAId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
  const businessBId = backend.seedBusiness({ name: "Beta Co", slug: "beta" });

  await backend.seedApiKey({
    businessId: businessAId,
    hashedKey: await hashApiKey(RAW_KEY_A),
    scopes: ["read", "write", "money"],
  });
  await backend.seedApiKey({
    businessId: businessBId,
    hashedKey: await hashApiKey(RAW_KEY_B),
    scopes: ["read", "write", "money"],
  });

  return { businessAId, businessBId };
}

function getRequest(id: string, bearer?: string) {
  return new Request(`https://api.thismade.internal/v1/orders/${id}`, {
    method: "GET",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  backend.reset();
});

describe("GET /v1/orders/{id}", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await GET(getRequest("whatever"), ctx("whatever"));
    expect(res.status).toBe(401);
  });

  it("returns the order when it belongs to the caller's business", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId, customerEmail: "buyer@example.com" });

    const res = await GET(getRequest(orderId, RAW_KEY_A), ctx(orderId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(orderId);
    expect(body.data.customerEmail).toBe("buyer@example.com");
    expect(body.data.status).toBe("paid");
  });

  it("returns not_found (404), never forbidden (403), for a cross-tenant id", async () => {
    const { businessAId } = await seedTwoBusinesses();
    const orderId = backend.seedOrder({ businessId: businessAId });

    const res = await GET(getRequest(orderId, RAW_KEY_B), ctx(orderId));
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
