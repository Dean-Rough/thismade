import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";
import { readIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { createCheckoutSession } from "@/lib/stripe/checkout";

const ROUTE = "POST /v1/checkout-links";

function getConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}

export async function POST(req: Request) {
  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return apiError("unauthorized", "Missing or invalid API key.");
  }
  // Per madethis-rebuild-plan.md §3: the `money` scope gates both checkout
  // creation and payout access, restricted to business owners.
  if (!requireScope(auth.context, "money")) {
    return apiError("forbidden_scope", "This API key lacks the 'money' scope.");
  }

  const idempotency = readIdempotencyKey(req);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  const rawBody = await req.text();
  const client = getConvexClient();

  return withIdempotency(
    client,
    auth.context.businessId,
    ROUTE,
    idempotency.key,
    rawBody,
    async () => {
      let parsed: unknown;
      try {
        parsed = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        return apiError("validation_failed", "Request body must be valid JSON.");
      }

      const body = parsed as Record<string, unknown>;
      if (typeof body.productId !== "string" || body.productId.length === 0) {
        return apiError("validation_failed", "productId must be a non-empty string.");
      }

      // A malformed id must also read as not_found, not a 500 — mirrors
      // app/v1/products/[id]/route.ts's fetchScopedProduct.
      let product;
      try {
        product = await client.query(api.products.getScopedById, {
          productId: body.productId as Id<"products">,
          businessId: auth.context.businessId,
        });
      } catch {
        product = null;
      }
      if (!product) {
        return apiError("not_found", "Product not found.");
      }
      if (product.status !== "active") {
        return apiError(
          "validation_failed",
          "Checkout links can only be created for active products.",
        );
      }
      if (!product.stripePriceId) {
        // Shouldn't happen: activation syncs stripePriceId before the status
        // flips to "active" (see lib/stripe/products.ts). Fail loudly rather
        // than silently building a checkout link with no price.
        return apiError("internal", "Product is active but missing a synced Stripe price.");
      }

      const business = await client.query(api.businesses.getSelf, {
        businessId: auth.context.businessId,
      });
      if (!business?.checkoutReturnUrl) {
        return apiError(
          "validation_failed",
          "Set checkoutReturnUrl via PATCH /v1/business before creating checkout links.",
        );
      }

      let session;
      try {
        session = await createCheckoutSession({
          priceId: product.stripePriceId,
          successUrl: `${business.checkoutReturnUrl}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${business.checkoutReturnUrl}?checkout=cancelled`,
          // The webhook (app/api/webhooks/stripe/route.ts) reads these back
          // off the completed session to create the orders row — see
          // convex/orders.ts.
          metadata: {
            businessId: auth.context.businessId,
            productId: product._id,
          },
        });
      } catch {
        return apiError("internal", "Failed to create Stripe checkout session.");
      }

      return ok({ url: session.url }, { status: 201 });
    },
  );
}
