const STRIPE_API_BASE = "https://api.stripe.com/v1";

export type StripeSyncInput = {
  title: string;
  priceAmountCents: number;
  currency: string;
};

export type StripeSyncResult = {
  stripeProductId: string;
  stripePriceId: string;
};

// Hard constraint: this build never talks to live Stripe. Reject anything
// that isn't an explicit test-mode secret key rather than silently
// proceeding or falling back to some other key.
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

async function stripeRequest(path: string, body: Record<string, string>): Promise<{ id: string }> {
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

// Creates a Stripe Product + Price in test mode for a product transitioning
// to "active". Called from the REST layer (not a Convex mutation, which
// can't make outbound HTTP calls) before the transition is persisted, so a
// Stripe failure never leaves a product marked active without synced ids.
export async function syncProductToStripe(input: StripeSyncInput): Promise<StripeSyncResult> {
  const product = await stripeRequest("/products", { name: input.title });
  const price = await stripeRequest("/prices", {
    product: product.id,
    unit_amount: String(input.priceAmountCents),
    currency: input.currency,
  });
  return { stripeProductId: product.id, stripePriceId: price.id };
}
