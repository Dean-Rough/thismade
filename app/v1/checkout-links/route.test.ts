import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
process.env.CONVEX_SERVICE_SECRET = "test-secret";
process.env.STRIPE_SECRET_KEY = "sk_test_fake";

// Fake Convex backend: mocks the wire boundary (`convex/browser`'s
// ConvexHttpClient) rather than the route's own logic — same approach as
// app/v1/products/[id]/route.test.ts.
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

  function seedBusiness(input: { name: string; slug: string; checkoutReturnUrl?: string }) {
    const id = nextId("business");
    businesses.set(id, {
      _id: id,
      name: input.name,
      slug: input.slug,
      lifecycleStatus: "active",
      checkoutReturnUrl: input.checkoutReturnUrl,
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

  function seedProduct(input: {
    businessId: string;
    status?: "active" | "draft" | "archived";
    stripePriceId?: string;
  }) {
    const id = nextId("product");
    products.set(id, {
      _id: id,
      businessId: input.businessId,
      title: "Handmade Mug",
      description: "A mug.",
      priceAmountCents: 1500,
      currency: "usd",
      status: input.status ?? "active",
      stripeProductId: input.status === "active" ? "prod_existing" : undefined,
      stripePriceId: input.stripePriceId === undefined && input.status === "active"
        ? "price_existing"
        : input.stripePriceId,
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
        const doc = products.get(args.productId);
        if (!doc || doc.businessId !== args.businessId) return null;
        return doc;
      }
      case "businessesActions:getSelf": {
        return businesses.get(args.businessId) ?? null;
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

const { POST } = await import("./route");

const RAW_KEY_MONEY = "tm_test_money_secret";
const RAW_KEY_NO_MONEY = "tm_test_no_money_secret";

async function seedBusiness(opts: { checkoutReturnUrl?: string } = {}) {
  const businessId = backend.seedBusiness({
    name: "Alpha Co",
    slug: "alpha",
    // `?? default` would silently reinstate a URL even when a test passes
    // `checkoutReturnUrl: undefined` on purpose (to prove the "not
    // configured" rejection) — key presence must win over the fallback.
    checkoutReturnUrl: "checkoutReturnUrl" in opts ? opts.checkoutReturnUrl : "https://alpha.example/checkout",
  });
  await backend.seedApiKey({
    businessId,
    hashedKey: await hashApiKey(RAW_KEY_MONEY),
    scopes: ["read", "write", "money"],
  });
  await backend.seedApiKey({
    businessId,
    hashedKey: await hashApiKey(RAW_KEY_NO_MONEY),
    scopes: ["read", "write"],
  });
  return businessId;
}

function postRequest(opts: { bearer?: string; idempotencyKey?: string; body?: unknown }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new Request("https://api.thismade.internal/v1/checkout-links", {
    method: "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

function stripeCheckoutFetchMock(sessionId = "cs_test_123") {
  return vi.fn(async (url: string, _init: RequestInit) => {
    if (url === "https://api.stripe.com/v1/checkout/sessions") {
      return new Response(
        JSON.stringify({ id: sessionId, url: `https://checkout.stripe.com/c/pay/${sessionId}` }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
}

beforeEach(() => {
  backend.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /v1/checkout-links", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await POST(postRequest({ body: { productId: "whatever" } }));
    expect(res.status).toBe(401);
  });

  it("requires the money scope", async () => {
    const businessId = await seedBusiness();
    const productId = backend.seedProduct({ businessId, status: "active" });

    const res = await POST(
      postRequest({
        bearer: RAW_KEY_NO_MONEY,
        idempotencyKey: "req-1",
        body: { productId },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("requires an Idempotency-Key header", async () => {
    const businessId = await seedBusiness();
    const productId = backend.seedProduct({ businessId, status: "active" });

    const res = await POST(postRequest({ bearer: RAW_KEY_MONEY, body: { productId } }));
    expect(res.status).toBe(400);
  });

  it("returns not_found (404), never forbidden (403), for a cross-tenant productId", async () => {
    const businessId = await seedBusiness();
    const otherBusinessId = backend.seedBusiness({ name: "Beta Co", slug: "beta" });
    const productId = backend.seedProduct({ businessId: otherBusinessId, status: "active" });
    void businessId;

    const res = await POST(
      postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "req-1", body: { productId } }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("not_found");
  });

  it("rejects a draft product", async () => {
    const businessId = await seedBusiness();
    const productId = backend.seedProduct({ businessId, status: "draft" });

    const res = await POST(
      postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "req-1", body: { productId } }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("rejects an archived product", async () => {
    const businessId = await seedBusiness();
    const productId = backend.seedProduct({ businessId, status: "archived" });

    const res = await POST(
      postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "req-1", body: { productId } }),
    );
    expect(res.status).toBe(400);
  });

  it("requires checkoutReturnUrl to be configured on the business", async () => {
    const businessId = await seedBusiness({ checkoutReturnUrl: undefined });
    const productId = backend.seedProduct({ businessId, status: "active" });

    const res = await POST(
      postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "req-1", body: { productId } }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("creates a Stripe test-mode checkout session and returns its hosted URL", async () => {
    const businessId = await seedBusiness({ checkoutReturnUrl: "https://alpha.example/checkout" });
    const productId = backend.seedProduct({
      businessId,
      status: "active",
      stripePriceId: "price_test_123",
    });

    const fetchMock = stripeCheckoutFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(
      postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "req-1", body: { productId } }),
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.url).toBe("https://checkout.stripe.com/c/pay/cs_test_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sentBody = new URLSearchParams(init.body as string);
    expect(sentBody.get("line_items[0][price]")).toBe("price_test_123");
    expect(sentBody.get("success_url")).toContain("https://alpha.example/checkout");
    expect(sentBody.get("metadata[businessId]")).toBe(businessId);
    expect(sentBody.get("metadata[productId]")).toBe(productId);
  });

  it("replays the cached response on a duplicate Idempotency-Key instead of creating a second session", async () => {
    const businessId = await seedBusiness();
    const productId = backend.seedProduct({
      businessId,
      status: "active",
      stripePriceId: "price_test_123",
    });

    const fetchMock = stripeCheckoutFetchMock();
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(
      postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "dup", body: { productId } }),
    );
    const firstBody = await first.json();

    const second = await POST(
      postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "dup", body: { productId } }),
    );
    const secondBody = await second.json();

    expect(secondBody).toEqual(firstBody);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the first request hit Stripe
  });
});
