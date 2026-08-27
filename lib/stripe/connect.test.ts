import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnectExpressAccount, createConnectOnboardingLink } from "./connect";

const ORIGINAL_KEY = process.env.STRIPE_SECRET_KEY;

afterEach(() => {
  process.env.STRIPE_SECRET_KEY = ORIGINAL_KEY;
  vi.unstubAllGlobals();
});

describe("createConnectExpressAccount", () => {
  it("rejects when STRIPE_SECRET_KEY is not configured", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    await expect(createConnectExpressAccount()).rejects.toThrow(/not configured/);
  });

  it("rejects a live-mode secret key rather than silently using it", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_should_never_be_used";
    await expect(createConnectExpressAccount()).rejects.toThrow(/test-mode/);
  });

  it("creates a test-mode Express account with card_payments and transfers requested", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.stripe.com/v1/accounts");
      const body = new URLSearchParams(init.body as string);
      expect(body.get("type")).toBe("express");
      expect(body.get("capabilities[card_payments][requested]")).toBe("true");
      expect(body.get("capabilities[transfers][requested]")).toBe("true");
      expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk_test_fake");
      return new Response(JSON.stringify({ id: "acct_test_123" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const account = await createConnectExpressAccount();
    expect(account).toEqual({ id: "acct_test_123" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a Stripe API error instead of swallowing it", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("account creation declined", { status: 400 })),
    );
    await expect(createConnectExpressAccount()).rejects.toThrow(/400/);
  });
});

describe("createConnectOnboardingLink", () => {
  it("creates an account_onboarding link for the given account id", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_fake";
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.stripe.com/v1/account_links");
      const body = new URLSearchParams(init.body as string);
      expect(body.get("account")).toBe("acct_test_123");
      expect(body.get("refresh_url")).toBe("https://app.example/refresh");
      expect(body.get("return_url")).toBe("https://app.example/return");
      expect(body.get("type")).toBe("account_onboarding");
      return new Response(
        JSON.stringify({ url: "https://connect.stripe.com/setup/e/acct_test_123", expires_at: 1700000000 }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const link = await createConnectOnboardingLink("acct_test_123", {
      refreshUrl: "https://app.example/refresh",
      returnUrl: "https://app.example/return",
    });

    expect(link).toEqual({
      url: "https://connect.stripe.com/setup/e/acct_test_123",
      expiresAt: 1700000000,
    });
  });
});
