import { afterEach, describe, expect, it, vi } from "vitest";
import { refundCheckoutSession } from "./refunds";

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;

afterEach(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
  vi.unstubAllGlobals();
});

describe("refundCheckoutSession", () => {
  it("rejects when STRIPE_SECRET_KEY is not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(refundCheckoutSession("cs_test_123")).rejects.toThrow(/not configured/);
  });

  it("rejects a live-mode secret key rather than silently using it", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_be_used";
    await expect(refundCheckoutSession("cs_test_123")).rejects.toThrow(/test-mode/);
  });

  it("looks up the session's payment intent, then refunds it, returning the refund id/status", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "https://api.stripe.com/v1/checkout/sessions/cs_test_123") {
        expect(init?.method).toBe("GET");
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer sk_test_fake");
        return new Response(JSON.stringify({ payment_intent: "pi_test_abc" }), { status: 200 });
      }
      if (url === "https://api.stripe.com/v1/refunds") {
        const body = new URLSearchParams(init?.body as string);
        expect(body.get("payment_intent")).toBe("pi_test_abc");
        return new Response(JSON.stringify({ id: "re_test_1", status: "succeeded" }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await refundCheckoutSession("cs_test_123");

    expect(result).toEqual({ id: "re_test_1", status: "succeeded" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws instead of refunding when the session has no payment intent", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ payment_intent: null }), { status: 200 })),
    );

    await expect(refundCheckoutSession("cs_test_123")).rejects.toThrow(/no associated payment intent/);
  });

  it("surfaces a Stripe API error instead of swallowing it", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not found", { status: 404 })),
    );

    await expect(refundCheckoutSession("cs_test_123")).rejects.toThrow(/404/);
  });
});
