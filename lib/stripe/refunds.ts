const STRIPE_API_BASE = "https://api.stripe.com/v1";

export type RefundResult = {
  id: string;
  status: string;
};

// Hard constraint: this build never talks to live Stripe. Reject anything
// that isn't an explicit test-mode secret key rather than silently
// proceeding or falling back to some other key. Mirrors
// lib/stripe/products.ts, lib/stripe/checkout.ts, lib/stripe/connect.ts.
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

async function stripeGet<T>(path: string): Promise<T> {
  const key = getTestModeSecretKey();
  const res = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Stripe request to ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function stripePost<T>(path: string, body: Record<string, string>): Promise<T> {
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

// Refunds the payment behind a completed Checkout Session, called from
// POST /v1/orders/{id}/refund. The order row only stores
// stripeCheckoutSessionId (see convex/orders.ts), not the underlying
// PaymentIntent, so this first re-fetches the session from Stripe to read
// its payment_intent before issuing the refund against it.
export async function refundCheckoutSession(stripeCheckoutSessionId: string): Promise<RefundResult> {
  const session = await stripeGet<{ payment_intent: string | null }>(
    `/checkout/sessions/${stripeCheckoutSessionId}`,
  );
  if (!session.payment_intent) {
    throw new Error("Checkout session has no associated payment intent to refund.");
  }

  const refund = await stripePost<{ id: string; status: string }>("/refunds", {
    payment_intent: session.payment_intent,
  });
  return { id: refund.id, status: refund.status };
}
