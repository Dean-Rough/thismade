import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";
import { readIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { serializeOrder } from "@/lib/api/orders";
import { getConvexServiceSecret } from "@/lib/api/serviceSecret";
import { refundCheckoutSession } from "@/lib/stripe/refunds";

const ROUTE = "POST /v1/orders/:id/refund";

function getConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}

// A malformed id (not just a cross-tenant one) must also read as 404, never
// a 500 — mirrors app/v1/products/[id]/route.ts's fetchScopedProduct.
async function fetchScopedOrder(
  client: ConvexHttpClient,
  businessId: Id<"businesses">,
  rawId: string,
): Promise<Doc<"orders"> | null> {
  try {
    return await client.action(api.ordersActions.getScopedById, {
      orderId: rawId as Id<"orders">,
      businessId,
      secret: getConvexServiceSecret(),
    });
  } catch {
    return null;
  }
}

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return apiError("unauthorized", "Missing or invalid API key.");
  }
  // Per madethis-rebuild-plan.md §3: refunds move money, so they're gated
  // behind the same 'money' scope as checkout-link creation and payouts.
  if (!requireScope(auth.context, "money")) {
    return apiError("forbidden_scope", "This API key lacks the 'money' scope.");
  }

  const idempotency = readIdempotencyKey(req);
  if (!idempotency.ok) {
    return idempotency.response;
  }

  const { id } = await context.params;
  const rawBody = await req.text();
  const client = getConvexClient();

  return withIdempotency(
    client,
    auth.context.businessId,
    ROUTE,
    idempotency.key,
    rawBody,
    async () => {
      const existing = await fetchScopedOrder(client, auth.context.businessId, id);
      if (!existing) {
        return apiError("not_found", "Order not found.");
      }

      // Reject before ever touching Stripe again — see DECISIONS.md §orders
      // on why this is a dedicated `refund_already_issued` (409) code rather
      // than a generic validation_failed.
      if (existing.status === "refunded") {
        return apiError("refund_already_issued", "This order has already been refunded.");
      }

      try {
        await refundCheckoutSession(existing.stripeCheckoutSessionId);
      } catch {
        return apiError("internal", "Failed to refund the order via Stripe test mode.");
      }

      const updated = await client.action(api.ordersActions.markRefunded, {
        businessId: auth.context.businessId,
        orderId: existing._id,
        refundedAt: Date.now(),
        secret: getConvexServiceSecret(),
      });
      if (!updated) {
        return apiError("not_found", "Order not found.");
      }

      return ok(serializeOrder(updated));
    },
  );
}
