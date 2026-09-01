import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";
import { serializeOrder } from "@/lib/api/orders";
import { getConvexServiceSecret } from "@/lib/api/serviceSecret";

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

export async function GET(req: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return apiError("unauthorized", "Missing or invalid API key.");
  }
  if (!requireScope(auth.context, "read")) {
    return apiError("forbidden_scope", "This API key lacks the 'read' scope.");
  }

  const { id } = await context.params;
  const client = getConvexClient();
  const order = await fetchScopedOrder(client, auth.context.businessId, id);

  if (!order) {
    return apiError("not_found", "Order not found.");
  }

  return ok(serializeOrder(order));
}
