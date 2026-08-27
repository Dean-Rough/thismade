import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { StripeSignatureError, constructStripeEvent } from "@/lib/stripe/webhook";

// Inbound Stripe webhook. Deliberately not a /v1/* route: this is Stripe
// calling us, not an API-key-authenticated platform client, so it doesn't
// use the {data,hint,next_action} / {error} envelope contract — signature
// verification stands in for auth, and Stripe only inspects the HTTP status.
//
// One handler file for every inbound Stripe event type (THI-28's decision —
// see DECISIONS.md §payouts): account.updated (Connect payouts) and
// checkout.session.completed (orders) both switch on event.type here rather
// than living behind separate endpoint URLs.

function getConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Webhook not configured", { status: 500 });
  }

  const rawBody = await req.text();
  let event;
  try {
    event = await constructStripeEvent(rawBody, req.headers.get("stripe-signature"), secret);
  } catch (err) {
    if (err instanceof StripeSignatureError) {
      return new Response(err.message, { status: 400 });
    }
    throw err;
  }

  switch (event.type) {
    case "account.updated": {
      const account = event.data.object as {
        id: string;
        details_submitted?: boolean;
        charges_enabled?: boolean;
        payouts_enabled?: boolean;
      };
      const client = getConvexClient();
      await client.mutation(api.payouts.updateConnectStatusByStripeAccountId, {
        stripeConnectAccountId: account.id,
        detailsSubmitted: account.details_submitted ?? false,
        chargesEnabled: account.charges_enabled ?? false,
        payoutsEnabled: account.payouts_enabled ?? false,
      });
      break;
    }
    case "checkout.session.completed": {
      const session = event.data.object as {
        id: string;
        amount_total?: number | null;
        currency?: string | null;
        customer_email?: string | null;
        customer_details?: { email?: string | null } | null;
        metadata?: { businessId?: string; productId?: string } | null;
      };
      const businessId = session.metadata?.businessId;
      const productId = session.metadata?.productId;
      const customerEmail = session.customer_details?.email ?? session.customer_email;

      // A session missing the metadata we set at creation, or an
      // unpaid/no-email session, can never be turned into a valid order row.
      // Acknowledge (200) rather than error so Stripe doesn't retry a
      // delivery we can never process.
      if (!businessId || !productId || !customerEmail || session.currency == null || session.amount_total == null) {
        break;
      }

      const client = getConvexClient();
      await client.mutation(api.orders.createFromCheckoutSession, {
        businessId: businessId as Id<"businesses">,
        productId: productId as Id<"products">,
        customerEmail,
        amountCents: session.amount_total,
        currency: session.currency,
        stripeCheckoutSessionId: session.id,
      });
      break;
    }
    default:
      // Unhandled event types are acknowledged, not errors — Stripe retries
      // on non-2xx, which we only want for real processing failures.
      break;
  }

  return new Response(null, { status: 200 });
}
