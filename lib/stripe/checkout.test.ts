import { afterEach, describe, expect, it, vi } from "vitest";
import { createCheckoutSession } from "./checkout";

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;

afterEach(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
  vi.unstubAllGlobals();
});

const BASE_INPUT = {
  priceId: "price_test_123",
  successUrl: "https://example.com/success",
  cancelUrl: "https://example.com/cancel",
  metadata: { businessId: "biz_1", productId: "prod_1" },
};

describe("createCheckoutSession", () => {
  it("rejects when STRIPE_SECRET_KEY is not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(createCheckoutSession(BASE_INPUT)).rejects.toThrow(/not configured/);
  });

  it("rejects a live-mode secret key rather than silently using it", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_be_used";
    await expect(createCheckoutSession(BASE_INPUT)).rejects.toThrow(/test-mode/);
  });

  it("creates a payment-mode test session with the price, urls, and metadata", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.stripe.com/v1/checkout/sessions");
      const body = new URLSearchParams(init.body as string);
      expect(body.get("mode")).toBe("payment");
      expect(body.get("line_items[0][price]")).toBe("price_test_123");
      expect(body.get("line_items[0][quantity]")).toBe("1");
      expect(body.get("success_url")).toBe("https://example.com/success");
      expect(body.get("cancel_url")).toBe("https://example.com/cancel");
      expect(body.get("metadata[businessId]")).toBe("biz_1");
      expect(body.get("metadata[productId]")).toBe("prod_1");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk_test_fake");
      return new Response(
        JSON.stringify({ id: "cs_test_123", url: "https://checkout.stripe.com/c/pay/cs_test_123" }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = await createCheckoutSession(BASE_INPUT);

    expect(session).toEqual({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a Stripe API error instead of swallowing it", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("invalid price", { status: 400 })),
    );

    await expect(createCheckoutSession(BASE_INPUT)).rejects.toThrow(/400/);
  });
});
