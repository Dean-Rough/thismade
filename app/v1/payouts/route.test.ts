import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashApiKey } from "@/convex/lib/apiKeyCrypto";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";

// Fake Convex backend mocking the wire boundary (`convex/browser`), matching
// app/v1/business/route.test.ts — proves auth, scope, envelope, and tenancy
// end to end through the real route handler.
const backend = vi.hoisted(() => {
  const businesses = new Map<string, any>();
  const apiKeys = new Map<string, any>();
  let counter = 0;

  function nextId(prefix: string) {
    counter += 1;
    return `${prefix}_${counter}`;
  }

  function reset() {
    businesses.clear();
    apiKeys.clear();
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
      default:
        throw new Error(`Unhandled fake Convex function in test: ${name}`);
    }
  }

  return { businesses, apiKeys, reset, seedBusiness, seedApiKey, dispatch };
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

const RAW_KEY_MONEY = "tm_test_money_secret";
const RAW_KEY_READONLY = "tm_test_readonly_secret";

function getRequest(bearer?: string) {
  return new Request("https://api.thismade.internal/v1/payouts", {
    method: "GET",
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

beforeEach(() => {
  backend.reset();
});

describe("GET /v1/payouts", () => {
  it("returns unauthorized with no Authorization header", async () => {
    const res = await GET(getRequest());
    expect(res.status).toBe(401);
  });

  it("returns forbidden_scope for a key without the money scope", async () => {
    const businessId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
    await backend.seedApiKey({
      businessId,
      hashedKey: await hashApiKey(RAW_KEY_READONLY),
      scopes: ["read"],
    });

    const res = await GET(getRequest(RAW_KEY_READONLY));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden_scope");
  });

  it("starts false/false/false for a business that hasn't onboarded, per the Phase 2 acceptance criterion", async () => {
    const businessId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
    await backend.seedApiKey({
      businessId,
      hashedKey: await hashApiKey(RAW_KEY_MONEY),
      scopes: ["money"],
    });

    const res = await GET(getRequest(RAW_KEY_MONEY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual({
      stripeConnectAccountId: null,
      stripeConnectDetailsSubmitted: false,
      stripeConnectChargesEnabled: false,
      stripeConnectPayoutsEnabled: false,
    });
  });

  it("reflects flipped flags once onboarding has completed", async () => {
    const businessId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
    backend.businesses.get(businessId).stripeConnectAccountId = "acct_test_123";
    backend.businesses.get(businessId).stripeConnectDetailsSubmitted = true;
    backend.businesses.get(businessId).stripeConnectChargesEnabled = true;
    backend.businesses.get(businessId).stripeConnectPayoutsEnabled = true;
    await backend.seedApiKey({
      businessId,
      hashedKey: await hashApiKey(RAW_KEY_MONEY),
      scopes: ["money"],
    });

    const res = await GET(getRequest(RAW_KEY_MONEY));
    const body = await res.json();
    expect(body.data.stripeConnectAccountId).toBe("acct_test_123");
    expect(body.data.stripeConnectDetailsSubmitted).toBe(true);
    expect(body.data.stripeConnectChargesEnabled).toBe(true);
    expect(body.data.stripeConnectPayoutsEnabled).toBe(true);
  });

  it("never leaks another business's payout status", async () => {
    const businessAId = backend.seedBusiness({ name: "Alpha Co", slug: "alpha" });
    const businessBId = backend.seedBusiness({ name: "Beta Co", slug: "beta" });
    backend.businesses.get(businessAId).stripeConnectPayoutsEnabled = true;
    await backend.seedApiKey({
      businessId: businessBId,
      hashedKey: await hashApiKey(RAW_KEY_MONEY),
      scopes: ["money"],
    });

    const res = await GET(getRequest(RAW_KEY_MONEY));
    const body = await res.json();
    expect(body.data.stripeConnectPayoutsEnabled).toBe(false);
  });
});
