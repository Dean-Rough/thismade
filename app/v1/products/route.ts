import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";
import { readIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";

const ROUTE = "POST /v1/products";

function getConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}

function serializeProduct(product: Doc<"products">) {
  return {
    id: product._id,
    title: product.title,
    description: product.description,
    priceAmountCents: product.priceAmountCents,
    currency: product.currency,
    status: product.status,
    stripeProductId: product.stripeProductId ?? null,
    stripePriceId: product.stripePriceId ?? null,
    deliverableFileUrl: product.deliverableFileUrl ?? null,
  };
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
  const products = await client.query(api.products.listByBusiness, {
    businessId: auth.context.businessId,
  });

  return ok(products.map(serializeProduct));
}

export async function POST(req: Request) {
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

      const body = parsed as Record<string, unknown>;

      if (typeof body.title !== "string" || body.title.length === 0) {
        return apiError("validation_failed", "title must be a non-empty string.");
      }
      if (typeof body.description !== "string") {
        return apiError("validation_failed", "description must be a string.");
      }
      if (typeof body.priceAmountCents !== "number" || !Number.isInteger(body.priceAmountCents) || body.priceAmountCents < 0) {
        return apiError("validation_failed", "priceAmountCents must be a non-negative integer.");
      }
      if (typeof body.currency !== "string" || body.currency.length === 0) {
        return apiError("validation_failed", "currency must be a non-empty string.");
      }
      if (body.deliverableFileUrl !== undefined && typeof body.deliverableFileUrl !== "string") {
        return apiError("validation_failed", "deliverableFileUrl must be a string.");
      }

      const product = await client.mutation(api.products.create, {
        businessId: auth.context.businessId,
        title: body.title,
        description: body.description,
        priceAmountCents: body.priceAmountCents,
        currency: body.currency,
        deliverableFileUrl: body.deliverableFileUrl as string | undefined,
      });
      if (!product) {
        return apiError("internal", "Product was created but could not be read back.");
      }

      return ok(serializeProduct(product), { status: 201 });
    },
  );
}
