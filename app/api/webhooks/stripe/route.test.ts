import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.NEXT_PUBLIC_CONVEX_URL = "https://fake.convex.cloud";

const ORIGINAL_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const SECRET = "whsec_test_fake";

// Fake Convex backend mocking the wire boundary (`convex/browser`), matching
// app/v1/business/route.test.ts — proves the webhook drives the real
// payouts:updateConnectStatusByStripeAccountId and
// orders:createFromCheckoutSession mutations end to end. The orders map
// mirrors orders.createFromCheckoutSession's real check-then-insert-on-
// stripeCheckoutSessionId semantics closely enough to prove the webhook
// itself is idempotent end-to-end.
const backend = vi.hoisted(() => {
  const businesses = new Map<string, any>();
  const mutationCalls: any[] = [];
  const orders = new Map<string, any>();
  let orderCounter = 0;

  function reset() {
    businesses.clear();
    mutationCalls.length = 0;
    orders.clear();
    orderCounter = 0;
  }

  function seedBusiness(accountId: string) {
    const id = `business_${businesses.size + 1}`;
    businesses.set(id, {
      _id: id,
      stripeConnectAccountId: accountId,
      stripeConnectDetailsSubmitted: false,
      stripeConnectChargesEnabled: false,
      stripeConnectPayoutsEnabled: false,
    });
    return id;
  }

  async function dispatch(name: string, args: any): Promise<any> {
    switch (name) {
      case "payouts:updateConnectStatusByStripeAccountId": {
        mutationCalls.push(args);
        for (const b of businesses.values()) {
          if (b.stripeConnectAccountId === args.stripeConnectAccountId) {
            b.stripeConnectDetailsSubmitted = args.detailsSubmitted;
            b.stripeConnectChargesEnabled = args.chargesEnabled;
            b.stripeConnectPayoutsEnabled = args.payoutsEnabled;
            return b;
          }
        }
        return null;
      }
      case "orders:createFromCheckoutSession": {
        for (const order of orders.values()) {
          if (order.stripeCheckoutSessionId === args.stripeCheckoutSessionId) {
            return order;
          }
        }
        orderCounter += 1;
        const id = `order_${orderCounter}`;
        const order = {
          _id: id,
          businessId: args.businessId,
          productId: args.productId,
          customerEmail: args.customerEmail,
          amountCents: args.amountCents,
          currency: args.currency,
          status: "paid",
          stripeCheckoutSessionId: args.stripeCheckoutSessionId,
          createdAt: 0,
        };
        orders.set(id, order);
        return order;
      }
      default:
        throw new Error(`Unhandled fake Convex function in test: ${name}`);
    }
  }

  return { businesses, mutationCalls, orders, reset, seedBusiness, dispatch };
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

async function sign(payload: string, timestampSeconds: number, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestampSeconds}.${payload}`),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestampSeconds},v1=${hex}`;
}

function webhookRequest(payload: string, signatureHeader: string | null) {
  const headers: Record<string, string> = {};
  if (signatureHeader) headers["stripe-signature"] = signatureHeader;
  return new Request("https://api.thismade.internal/api/webhooks/stripe", {
    method: "POST",
    headers,
    body: payload,
  });
}

function checkoutCompletedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_abc",
        amount_total: 1500,
        currency: "usd",
        customer_details: { email: "buyer@example.com" },
        metadata: { businessId: "business_1", productId: "product_1" },
        ...overrides,
      },
    },
  };
}

async function signedCheckoutRequest(event: unknown) {
  const payload = JSON.stringify(event);
  const header = await sign(payload, Math.floor(Date.now() / 1000));
  return webhookRequest(payload, header);
}

beforeEach(() => {
  backend.reset();
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_WEBHOOK_SECRET;
});

describe("POST /api/webhooks/stripe", () => {
  it("returns 500 when STRIPE_WEBHOOK_SECRET is not configured", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(webhookRequest("{}", null));
    expect(res.status).toBe(500);
  });

  it("rejects a request with no signature header", async () => {
    const res = await POST(webhookRequest("{}", null));
    expect(res.status).toBe(400);
  });

  it("rejects a badly signed payload rather than trusting it", async () => {
    const payload = JSON.stringify({ id: "evt_1", type: "account.updated", data: { object: {} } });
    const header = await sign(payload, Math.floor(Date.now() / 1000), "whsec_wrong");
    const res = await POST(webhookRequest(payload, header));
    expect(res.status).toBe(400);
    expect(backend.mutationCalls).toHaveLength(0);
  });

  it("flips the Connect flags for the matching business on a valid account.updated event", async () => {
    backend.seedBusiness("acct_test_123");
    const account = {
      id: "acct_test_123",
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: true,
    };
    const payload = JSON.stringify({ id: "evt_1", type: "account.updated", data: { object: account } });
    const header = await sign(payload, Math.floor(Date.now() / 1000));

    const res = await POST(webhookRequest(payload, header));

    expect(res.status).toBe(200);
    expect(backend.mutationCalls).toEqual([
      {
        stripeConnectAccountId: "acct_test_123",
        detailsSubmitted: true,
        chargesEnabled: true,
        payoutsEnabled: true,
      },
    ]);
  });

  it("defaults missing boolean fields on the account object to false rather than throwing", async () => {
    backend.seedBusiness("acct_test_456");
    const payload = JSON.stringify({
      id: "evt_2",
      type: "account.updated",
      data: { object: { id: "acct_test_456" } },
    });
    const header = await sign(payload, Math.floor(Date.now() / 1000));

    const res = await POST(webhookRequest(payload, header));

    expect(res.status).toBe(200);
    expect(backend.mutationCalls[0]).toEqual({
      stripeConnectAccountId: "acct_test_456",
      detailsSubmitted: false,
      chargesEnabled: false,
      payoutsEnabled: false,
    });
  });

  it("acknowledges (200) but ignores event types it doesn't handle", async () => {
    const payload = JSON.stringify({ id: "evt_3", type: "charge.succeeded", data: { object: {} } });
    const header = await sign(payload, Math.floor(Date.now() / 1000));

    const res = await POST(webhookRequest(payload, header));

    expect(res.status).toBe(200);
    expect(backend.mutationCalls).toHaveLength(0);
  });

  it("creates exactly one order on checkout.session.completed", async () => {
    const res = await POST(await signedCheckoutRequest(checkoutCompletedEvent()));
    expect(res.status).toBe(200);
    expect(backend.orders.size).toBe(1);

    const order = [...backend.orders.values()][0];
    expect(order.businessId).toBe("business_1");
    expect(order.productId).toBe("product_1");
    expect(order.customerEmail).toBe("buyer@example.com");
    expect(order.amountCents).toBe(1500);
    expect(order.currency).toBe("usd");
    expect(order.stripeCheckoutSessionId).toBe("cs_test_abc");
  });

  it("creates exactly one order even when the same event is redelivered", async () => {
    const event = checkoutCompletedEvent();

    const first = await POST(await signedCheckoutRequest(event));
    expect(first.status).toBe(200);

    // Simulates Stripe redelivering the identical checkout.session.completed
    // event (retry after a timeout, or a manual resend from the dashboard).
    const second = await POST(await signedCheckoutRequest(event));
    expect(second.status).toBe(200);

    expect(backend.orders.size).toBe(1);
  });

  it("acknowledges (200) but does not create an order for a session missing our metadata", async () => {
    const res = await POST(await signedCheckoutRequest(checkoutCompletedEvent({ metadata: {} })));
    expect(res.status).toBe(200);
    expect(backend.orders.size).toBe(0);
  });
});
