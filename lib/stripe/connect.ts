const STRIPE_API_BASE = "https://api.stripe.com/v1";

export type ConnectAccount = {
  id: string;
};

export type ConnectOnboardingLink = {
  url: string;
  expiresAt: number;
};

// Hard constraint: this build never talks to live Stripe. Reject anything
// that isn't an explicit test-mode secret key rather than silently
// proceeding or falling back to some other key. Mirrors lib/stripe/products.ts.
function getTestModeSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  if (!key.startsWith("sk_test_")) {
    throw new Error("STRIPE_SECRET_KEY must be a Stripe test-mode secret key (sk_test_...).");
  }
  return key;
}

async function stripeRequest<T>(path: string, body: Record<string, string>): Promise<T> {
  const key = getTestModeSecretKey();
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Stripe request to ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

// Creates a test-mode Stripe Connect Express account with the capabilities a
// seller needs to receive card payments and payouts. Called once per
// business, the first time onboarding-link is requested — see
// convex/payouts.ts:setStripeConnectAccountId for why the id is persisted
// before capabilities can flip on.
export async function createConnectExpressAccount(): Promise<ConnectAccount> {
  return stripeRequest<ConnectAccount>("/accounts", {
    type: "express",
    "capabilities[card_payments][requested]": "true",
    "capabilities[transfers][requested]": "true",
  });
}

// Creates a fresh Account Link for hosted onboarding. Account Links expire
// quickly (a few minutes) and are single-use, so callers must generate a new
// one on every onboarding-link request rather than caching the URL.
export async function createConnectOnboardingLink(
  accountId: string,
  opts: { refreshUrl: string; returnUrl: string },
): Promise<ConnectOnboardingLink> {
  const link = await stripeRequest<{ url: string; expires_at: number }>("/account_links", {
    account: accountId,
    refresh_url: opts.refreshUrl,
    return_url: opts.returnUrl,
    type: "account_onboarding",
  });
  return { url: link.url, expiresAt: link.expires_at };
}
