import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";

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
  if (!requireScope(auth.context, "money")) {
    return apiError("forbidden_scope", "This API key lacks the 'money' scope.");
  }

  const client = getConvexClient();
  const status = await client.query(api.payouts.getConnectStatus, {
    businessId: auth.context.businessId,
  });

  if (!status) {
    return apiError("not_found", "Business not found.");
  }

  return ok(status);
}
