import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";

const ORIGINAL_STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
const ORIGINAL_APP_URL = process.env.NEXT_PUBLIC_APP_URL;

// Fake Convex backend mocking the wire boundary (`convex/browser`), matching
// app/v1/business/route.test.ts — proves auth, scope, idempotency, and the
// account-id-reuse behavior end to end through the real route handler.
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
      stripeConnectAccountId: undefined,
      stripeConnectDetailsSubmitted: undefined,
      stripeConnectChargesEnabled: undefined,
      stripeConnectPayoutsEnabled: undefined,
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
      case "payouts:getConnectStatus": {
        const b = businesses.get(args.businessId);
        if (!b) return null;
        return {
          stripeConnectAccountId: b.stripeConnectAccountId ?? null,
          stripeConnectDetailsSubmitted: b.stripeConnectDetailsSubmitted ?? false,
          stripeConnectChargesEnabled: b.stripeConnectChargesEnabled ?? false,
          stripeConnectPayoutsEnabled: b.stripeConnectPayoutsEnabled ?? false,
        };
      }
      case "payouts:setStripeConnectAccountId": {
        bump("payouts:setStripeConnectAccountId");
        const b = businesses.get(args.businessId);
        if (!b) return null;
        if (!b.stripeConnectAccountId) {
          b.stripeConnectAccountId = args.stripeConnectAccountId;
        }
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

  return { businesses, apiKeys, mutationCallCounts, reset, seedBusiness, seedApiKey, dispatch };
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

const { POST } = await import("./route");

const RAW_KEY_MONEY = "tm_test_money_secret";
const RAW_KEY_READONLY = "tm_test_readonly_secret";

function fakeStripeFetch() {
  let accountCounter = 0;
  return vi.fn(async (url: string) => {
    if (url === "https://api.stripe.com/v1/accounts") {
      accountCounter += 1;
      return new Response(JSON.stringify({ id: `acct_test_${accountCounter}` }), { status: 200 });
    }
    if (url === "https://api.stripe.com/v1/account_links") {
      return new Response(
        JSON.stringify({ url: "https://connect.stripe.com/setup/e/acct_test", expires_at: 1700000000 }),
        { status: 200 },
      );
    }
    throw new Error(`Unexpected Stripe URL: ${url}`);
  });
}

function postRequest(opts: { bearer?: string; idempotencyKey?: string }) {
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  return new Request("https://api.thismade.internal/v1/payouts/onboarding-link", {
    method: "POST",
    headers,
  });
}

beforeEach(() => {
  backend.reset();
  process.env.STRIPE_SECRET_KEY = "sk_test_fake";
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
});

afterEach(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_KEY;
  process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_APP_URL;
  vi.unstubAllGlobals();
});

describe("POST /v1/payouts/onboarding-link", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await POST(postRequest({}));
    expect(res.status).toBe(401);
  });

  it("returns forbidden_scope for a key without the money scope", async () => {
    const businessId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
    await backend.seedApiKey({
      businessId,
      hashedKey: await hashApiKey(RAW_KEY_READONLY),
      scopes: ["read"],
    });

    const res = await POST(postRequest({ bearer: RAW_KEY_READONLY, idempotencyKey: "req-1" }));
    expect(res.status).toBe(403);
  });

  it("requires an Idempotency-Key header", async () => {
    const businessId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
    await backend.seedApiKey({
      businessId,
      hashedKey: await hashApiKey(RAW_KEY_MONEY),
      scopes: ["money"],
    });

    const res = await POST(postRequest({ bearer: RAW_KEY_MONEY }));
    expect(res.status).toBe(400);
  });

  it("creates a test-mode Connect account, persists its id, and returns a usable onboarding URL", async () => {
    const businessId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
    await backend.seedApiKey({
      businessId,
      hashedKey: await hashApiKey(RAW_KEY_MONEY),
      scopes: ["money"],
    });
    vi.stubGlobal("fetch", fakeStripeFetch());

    const res = await POST(postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "req-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.url).toBe("https://connect.stripe.com/setup/e/acct_test");
    expect(body.data.expiresAt).toBe(1700000000);
    expect(backend.businesses.get(businessId).stripeConnectAccountId).toBe("acct_test_1");
  });

  it("reuses the existing Connect account on a later call instead of creating a second one", async () => {
    const businessId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
    await backend.seedApiKey({
      businessId,
      hashedKey: await hashApiKey(RAW_KEY_MONEY),
      scopes: ["money"],
    });
    const fetchMock = fakeStripeFetch();
    vi.stubGlobal("fetch", fetchMock);

    await POST(postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "req-1" }));
    await POST(postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "req-2" }));

    const accountCreationCalls = fetchMock.mock.calls.filter(
      ([url]) => url === "https://api.stripe.com/v1/accounts",
    );
    expect(accountCreationCalls).toHaveLength(1);
    expect(backend.mutationCallCounts.get("payouts:setStripeConnectAccountId")).toBe(1);
  });

  it("replays the cached response on a duplicate Idempotency-Key without calling Stripe again", async () => {
    const businessId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
    await backend.seedApiKey({
      businessId,
      hashedKey: await hashApiKey(RAW_KEY_MONEY),
      scopes: ["money"],
    });
    const fetchMock = fakeStripeFetch();
    vi.stubGlobal("fetch", fetchMock);

    const first = await POST(postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "dup-key" }));
    const firstBody = await first.json();
    const second = await POST(postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "dup-key" }));
    const secondBody = await second.json();

    expect(secondBody).toEqual(firstBody);
    expect(fetchMock).toHaveBeenCalledTimes(2); // one account create + one account link, not four
  });

  // THI-29 gate audit: GET /v1/payouts has a "never leaks another business's
  // payout status" test; this route (the mutation half of Connect payouts)
  // had no isolation test of any kind. There's no cross-tenant id to pass
  // here (the business is derived from the API key), so the equivalent
  // proof is that a business already mid-onboarding is left untouched by a
  // *different* business's onboarding-link call using its own key.
  it("never touches another business's existing Connect account when a different business onboards", async () => {
    const businessAId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
    backend.businesses.get(businessAId).stripeConnectAccountId = "acct_existing_alpha";
    const businessBId = backend.seedBusiness({ name: "Beta Co", slug: "beta" });
    await backend.seedApiKey({
      businessId: businessBId,
      hashedKey: await hashApiKey(RAW_KEY_MONEY),
      scopes: ["money"],
    });
    vi.stubGlobal("fetch", fakeStripeFetch());

    const res = await POST(postRequest({ bearer: RAW_KEY_MONEY, idempotencyKey: "req-1" }));
    expect(res.status).toBe(200);

    // Business B got its own fresh account, never Alpha's.
    expect(backend.businesses.get(businessBId).stripeConnectAccountId).toBe("acct_test_1");
    // Alpha's pre-existing account id is untouched.
    expect(backend.businesses.get(businessAId).stripeConnectAccountId).toBe("acct_existing_alpha");
  });
});
