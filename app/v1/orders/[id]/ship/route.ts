import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";
import { readIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { serializeOrder } from "@/lib/api/orders";

const ROUTE = "POST /v1/orders/:id/ship";

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
    return await client.query(api.orders.getScopedById, {
      orderId: rawId as Id<"orders">,
      businessId,
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
  if (!requireScope(auth.context, "write")) {
    return apiError("forbidden_scope", "This API key lacks the 'write' scope.");
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
      let parsed: unknown;
      try {
        parsed = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        return apiError("validation_failed", "Request body must be valid JSON.");
      }

      const body = parsed as Record<string, unknown>;
      if (typeof body.trackingCode !== "string" || body.trackingCode.length === 0) {
        return apiError("validation_failed", "trackingCode must be a non-empty string.");
      }

      const existing = await fetchScopedOrder(client, auth.context.businessId, id);
      if (!existing) {
        return apiError("not_found", "Order not found.");
      }

      // Reject a double-ship; shippedAt/refundedAt are independent facts, so
      // a refunded order may still be shipped (or was already shipped before
      // being refunded) — see DECISIONS.md §orders.
      if (existing.shippedAt !== undefined) {
        return apiError("validation_failed", "This order has already been shipped.");
      }

      const updated = await client.mutation(api.orders.markShipped, {
        businessId: auth.context.businessId,
        orderId: existing._id,
        shippedAt: Date.now(),
        trackingCode: body.trackingCode,
      });
      if (!updated) {
        return apiError("not_found", "Order not found.");
      }

      return ok(serializeOrder(updated));
    },
  );
}
