import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { StripeSignatureError, constructStripeEvent } from "@/lib/stripe/webhook";

// Inbound Stripe webhook. Deliberately not a /v1/* route: this is Stripe
// calling us, not an API-key-authenticated platform client, so it doesn't
// use the {data,hint,next_action} / {error} envelope contract — signature
// verification stands in for auth, and Stripe only inspects the HTTP status.
//
// Currently only Stripe Connect's account.updated is handled (THI-28). If a
// future ticket adds Checkout's own webhook (payment/order events), extend
// the switch below rather than adding a second handler file.

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
    default:
      // Unhandled event types are acknowledged, not errors — Stripe retries
      // on non-2xx, which we only want for real processing failures.
      break;
  }

  return new Response(null, { status: 200 });
}
