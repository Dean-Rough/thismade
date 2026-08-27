const STRIPE_API_BASE = "https://api.stripe.com/v1";

export type CheckoutSessionInput = {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
};

export type CheckoutSessionResult = {
  id: string;
  url: string;
};

// Hard constraint: this build never talks to live Stripe. Reject anything
// that isn't an explicit test-mode secret key rather than silently
// proceeding or falling back to some other key. Mirrors
// lib/stripe/products.ts and lib/stripe/connect.ts.
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

// Creates a test-mode Stripe Checkout Session (hosted page) for a single
// product/price, called from POST /v1/checkout-links. `metadata` carries our
// own businessId/productId so the checkout.session.completed webhook can
// create the orders row directly from the event payload, without a second
// lookup keyed on the Stripe price id. See convex/orders.ts.
export async function createCheckoutSession(
  input: CheckoutSessionInput,
): Promise<CheckoutSessionResult> {
  const body: Record<string, string> = {
    mode: "payment",
    "line_items[0][price]": input.priceId,
    "line_items[0][quantity]": "1",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  };
  for (const [key, value] of Object.entries(input.metadata)) {
    body[`metadata[${key}]`] = value;
  }

  const session = await stripeRequest<{ id: string; url: string }>("/checkout/sessions", body);
  return { id: session.id, url: session.url };
}
