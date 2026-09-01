import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";
import { readIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { getConvexServiceSecret } from "@/lib/api/serviceSecret";

const ROUTE = "PATCH /v1/business";

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

  const client = getConvexClient();
  const business = await client.action(api.businessesActions.getSelf, {
    businessId: auth.context.businessId,
    secret: getConvexServiceSecret(),
  });

  if (!business) {
    // The api key row outlived its business, or the business was removed.
    // Treated identically to any other cross-tenant miss: not_found, never
    // a 500 or a 403 that would confirm something used to exist.
    return apiError("not_found", "Business not found.");
  }

  return ok({
    id: business._id,
    name: business.name,
    slug: business.slug,
    lifecycleStatus: business.lifecycleStatus,
    checkoutReturnUrl: business.checkoutReturnUrl ?? null,
  });
}

export async function PATCH(req: Request) {
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

      const checkoutReturnUrl = (parsed as Record<string, unknown>)?.checkoutReturnUrl;
      if (typeof checkoutReturnUrl !== "string" || checkoutReturnUrl.length === 0) {
        return apiError("validation_failed", "checkoutReturnUrl must be a non-empty string.");
      }

      const business = await client.action(api.businessesActions.updateCheckoutReturnUrl, {
        businessId: auth.context.businessId,
        checkoutReturnUrl,
        secret: getConvexServiceSecret(),
      });

      if (!business) {
        return apiError("not_found", "Business not found.");
      }

      return ok({
        id: business._id,
        name: business.name,
        slug: business.slug,
        lifecycleStatus: business.lifecycleStatus,
        checkoutReturnUrl: business.checkoutReturnUrl ?? null,
      });
    },
  );
}
