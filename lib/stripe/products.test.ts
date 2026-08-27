import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncProductToStripe } from "./products";

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;

afterEach(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
  vi.unstubAllGlobals();
});

describe("syncProductToStripe", () => {
  it("rejects when STRIPE_SECRET_KEY is not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(
      syncProductToStripe({ title: "Mug", priceAmountCents: 1500, currency: "usd" }),
    ).rejects.toThrow(/not configured/);
  });

  it("rejects a live-mode secret key rather than silently using it", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_be_used";
    await expect(
      syncProductToStripe({ title: "Mug", priceAmountCents: 1500, currency: "usd" }),
    ).rejects.toThrow(/test-mode/);
  });

  it("creates a test-mode Product then a Price against it, returning both ids", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = new URLSearchParams(init.body as string);
      if (url.endsWith("/v1/products")) {
        expect(body.get("name")).toBe("Mug");
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk_test_fake");
        return new Response(JSON.stringify({ id: "prod_test_123" }), { status: 200 });
      }
      if (url.endsWith("/v1/prices")) {
        expect(body.get("product")).toBe("prod_test_123");
        expect(body.get("unit_amount")).toBe("1500");
        expect(body.get("currency")).toBe("usd");
        return new Response(JSON.stringify({ id: "price_test_123" }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncProductToStripe({
      title: "Mug",
      priceAmountCents: 1500,
      currency: "usd",
    });

    expect(result).toEqual({ stripeProductId: "prod_test_123", stripePriceId: "price_test_123" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("surfaces a Stripe API error instead of swallowing it", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("card declined", { status: 402 })),
    );

    await expect(
      syncProductToStripe({ title: "Mug", priceAmountCents: 1500, currency: "usd" }),
    ).rejects.toThrow(/402/);
  });
});
