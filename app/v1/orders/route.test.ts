import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
process.env.CONVEX_SERVICE_SECRET = "test-secret";

// Fake Convex backend: mocks the wire boundary (`convex/browser`'s
// ConvexHttpClient) rather than the route's own logic — same approach as
// app/v1/products/route.test.ts.
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
      case "apiKeysActions:verifyByHash": {
        for (const key of apiKeys.values()) {
          if (key.hashedKey === args.hashedKey && !key.revokedAt) return key;
        }
        return null;
      }
      case "apiKeysActions:touchLastUsed":
        return null;
      case "ordersActions:listByBusiness": {
        return Array.from(orders.values()).filter((o) => o.businessId === args.businessId);
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
      async action(fnRef: unknown, args: unknown) {
        return backend.dispatch(getFunctionName(fnRef as never), args);
      }
    },
  };
});

const { GET } = await import("./route");

const RAW_KEY_A = "tm_test_business_a_secret";
const RAW_KEY_B = "tm_test_business_b_secret";
const RAW_KEY_WRITE_ONLY = "tm_test_write_only_secret";

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
    hashedKey: await hashApiKey(RAW_KEY_WRITE_ONLY),
    scopes: ["write"],
  });

  return { businessAId, businessBId };
}

function getRequest(bearer?: string) {
  return new Request("https://api.thismade.internal/v1/orders", {
    method: "GET",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

beforeEach(() => {
  backend.reset();
});

describe("GET /v1/orders", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it("requires the read scope", async () => {
    await seedTwoBusinesses();
    const res = await GET(getRequest(RAW_KEY_WRITE_ONLY));
    expect(res.status).toBe(403);
  });

  it("lists only the caller's own business's orders", async () => {
    const { businessAId, businessBId } = await seedTwoBusinesses();
    backend.seedOrder({ businessId: businessAId, customerEmail: "a@example.com" });
    backend.seedOrder({ businessId: businessBId, customerEmail: "b@example.com" });

    const res = await GET(getRequest(RAW_KEY_A));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].customerEmail).toBe("a@example.com");
  });
});
