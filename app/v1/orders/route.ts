import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
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

export async function GET(req: Request) {
  const auth = await authenticateRequest(req);
  if (!auth.ok) {
    return apiError("unauthorized", "Missing or invalid API key.");
  }
  if (!requireScope(auth.context, "read")) {
    return apiError("forbidden_scope", "This API key lacks the 'read' scope.");
  }

  const client = getConvexClient();
  const orders = await client.action(api.ordersActions.listByBusiness, {
    businessId: auth.context.businessId,
    secret: getConvexServiceSecret(),
  });

  return ok(orders.map(serializeOrder));
}
