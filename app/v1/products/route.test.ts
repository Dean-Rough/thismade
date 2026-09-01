import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";
process.env.CONVEX_SERVICE_SECRET = "test-secret";

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
      case "productsActions:create": {
        const id = nextId("product");
        const doc = {
          _id: id,
          businessId: args.businessId,
          title: args.title,
          description: args.description,
          priceAmountCents: args.priceAmountCents,
          currency: args.currency,
          status: "draft",
          deliverableFileUrl: args.deliverableFileUrl,
        };
        products.set(id, doc);
        return doc;
      }
      case "productsActions:listByBusiness": {
        return Array.from(products.values()).filter((p) => p.businessId === args.businessId);
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

  return { businesses, apiKeys, products, idempotency, reset, seedBusiness, seedApiKey, dispatch };
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

const { GET, POST } = await import("./route");

const RAW_KEY_WRITE = "tm_test_write_secret";
const RAW_KEY_READONLY = "tm_test_readonly_secret";
const RAW_KEY_WRITE_ONLY = "tm_test_write_only_secret";

async function seedBusinessWithKeys() {
  const businessAId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
  const businessBId = backend.seedBusiness({ name: "Beta Co", slug: "beta" });

  await backend.seedApiKey({
    businessId: businessAId,
    hashedKey: await hashApiKey(RAW_KEY_WRITE),
    scopes: ["read", "write"],
  });
  await backend.seedApiKey({
    businessId: businessAId,
    hashedKey: await hashApiKey(RAW_KEY_READONLY),
    scopes: ["read"],
  });
  await backend.seedApiKey({
    businessId: businessAId,
    hashedKey: await hashApiKey(RAW_KEY_WRITE_ONLY),
    scopes: ["write"],
  });

  return { businessAId, businessBId };
}

function getRequest(bearer?: string) {
  return new Request("https://api.thismade.internal/v1/products", {
    method: "GET",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

function postRequest(opts: { bearer?: string; idempotencyKey?: string; body?: unknown }) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new Request("https://api.thismade.internal/v1/products", {
    method: "POST",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

beforeEach(() => {
  backend.reset();
});

describe("GET /v1/products", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it("requires the read scope", async () => {
    await seedBusinessWithKeys();
    const res = await GET(getRequest(RAW_KEY_WRITE_ONLY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden_scope");
  });

  it("lists only the caller's own business's products in the envelope", async () => {
    const { businessAId, businessBId } = await seedBusinessWithKeys();
    await backend.dispatch("productsActions:create", {
      businessId: businessAId,
      title: "A's Mug",
      description: "",
      priceAmountCents: 1000,
      currency: "usd",
    });
    await backend.dispatch("productsActions:create", {
      businessId: businessBId,
      title: "B's Mug",
      description: "",
      priceAmountCents: 2000,
      currency: "usd",
    });

    const res = await GET(getRequest(RAW_KEY_WRITE));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].title).toBe("A's Mug");
  });
});

describe("POST /v1/products", () => {
  it("requires an Idempotency-Key header", async () => {
    await seedBusinessWithKeys();
    const res = await POST(
      postRequest({
        bearer: RAW_KEY_WRITE,
        body: { title: "Mug", description: "", priceAmountCents: 1000, currency: "usd" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("requires the write scope", async () => {
    await seedBusinessWithKeys();
    const res = await POST(
      postRequest({
        bearer: RAW_KEY_READONLY,
        idempotencyKey: "req-1",
        body: { title: "Mug", description: "", priceAmountCents: 1000, currency: "usd" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects a missing title", async () => {
    await seedBusinessWithKeys();
    const res = await POST(
      postRequest({
        bearer: RAW_KEY_WRITE,
        idempotencyKey: "req-1",
        body: { description: "", priceAmountCents: 1000, currency: "usd" },
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("rejects a negative priceAmountCents", async () => {
    await seedBusinessWithKeys();
    const res = await POST(
      postRequest({
        bearer: RAW_KEY_WRITE,
        idempotencyKey: "req-1",
        body: { title: "Mug", description: "", priceAmountCents: -5, currency: "usd" },
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates a product defaulting to status draft, scoped to the caller's business", async () => {
    const { businessAId } = await seedBusinessWithKeys();
    const res = await POST(
      postRequest({
        bearer: RAW_KEY_WRITE,
        idempotencyKey: "req-1",
        body: { title: "Mug", description: "A mug.", priceAmountCents: 1500, currency: "usd" },
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.title).toBe("Mug");
    expect(body.data.status).toBe("draft");
    expect(body.data.stripeProductId).toBeNull();

    const stored = backend.products.get(body.data.id);
    expect(stored.businessId).toBe(businessAId);
  });

  it("replays the cached response for a duplicate Idempotency-Key instead of creating twice", async () => {
    await seedBusinessWithKeys();
    const body = { title: "Mug", description: "", priceAmountCents: 1500, currency: "usd" };

    const first = await POST(postRequest({ bearer: RAW_KEY_WRITE, idempotencyKey: "dup", body }));
    const firstBody = await first.json();
    const second = await POST(postRequest({ bearer: RAW_KEY_WRITE, idempotencyKey: "dup", body }));
    const secondBody = await second.json();

    expect(secondBody).toEqual(firstBody);
    expect(backend.products.size).toBe(1);
  });
});
