import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";
import { readIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { serializeProduct } from "@/lib/api/products";
import { syncProductToStripe } from "@/lib/stripe/products";

const ROUTE = "PATCH /v1/products/:id";

function getConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}

// A malformed id (not just a cross-tenant one) must also read as 404, never
// a 500 — otherwise the shape of the id itself would leak information an
// attacker could probe for. Convex's argument validator throws on a
// structurally invalid id, so that throw is folded into the same "not
// found" outcome as a genuinely missing or cross-tenant row.
async function fetchScopedProduct(
  client: ConvexHttpClient,
  businessId: Id<"businesses">,
  rawId: string,
): Promise<Doc<"products"> | null> {
  try {
    return await client.query(api.products.getScopedById, {
      productId: rawId as Id<"products">,
      businessId,
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
  const product = await fetchScopedProduct(client, auth.context.businessId, id);

  if (!product) {
    return apiError("not_found", "Product not found.");
  }

  return ok(serializeProduct(product));
}

export async function PATCH(req: Request, context: { params: Promise<{ id: string }> }) {
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
      const patch: {
        title?: string;
        description?: string;
        priceAmountCents?: number;
        currency?: string;
        status?: "active" | "draft" | "archived";
        deliverableFileUrl?: string;
      } = {};

      if (body.title !== undefined) {
        if (typeof body.title !== "string" || body.title.length === 0) {
          return apiError("validation_failed", "title must be a non-empty string.");
        }
        patch.title = body.title;
      }
      if (body.description !== undefined) {
        if (typeof body.description !== "string") {
          return apiError("validation_failed", "description must be a string.");
        }
        patch.description = body.description;
      }
      if (body.priceAmountCents !== undefined) {
        if (
          typeof body.priceAmountCents !== "number" ||
          !Number.isInteger(body.priceAmountCents) ||
          body.priceAmountCents < 0
        ) {
          return apiError("validation_failed", "priceAmountCents must be a non-negative integer.");
        }
        patch.priceAmountCents = body.priceAmountCents;
      }
      if (body.currency !== undefined) {
        if (typeof body.currency !== "string" || body.currency.length === 0) {
          return apiError("validation_failed", "currency must be a non-empty string.");
        }
        patch.currency = body.currency;
      }
      if (body.status !== undefined) {
        if (body.status !== "active" && body.status !== "draft" && body.status !== "archived") {
          return apiError("validation_failed", "status must be one of active, draft, archived.");
        }
        patch.status = body.status;
      }
      if (body.deliverableFileUrl !== undefined) {
        if (typeof body.deliverableFileUrl !== "string") {
          return apiError("validation_failed", "deliverableFileUrl must be a string.");
        }
        patch.deliverableFileUrl = body.deliverableFileUrl;
      }

      const existing = await fetchScopedProduct(client, auth.context.businessId, id);
      if (!existing) {
        return apiError("not_found", "Product not found.");
      }

      // Stripe sync runs (test mode only) before the transition is
      // persisted: if it fails, the product simply stays in its prior
      // status instead of being left "active" with no synced ids.
      let stripeIds: { stripeProductId: string; stripePriceId: string } | undefined;
      const willActivate = patch.status === "active" && existing.status !== "active";
      if (willActivate) {
        try {
          stripeIds = await syncProductToStripe({
            title: patch.title ?? existing.title,
            priceAmountCents: patch.priceAmountCents ?? existing.priceAmountCents,
            currency: patch.currency ?? existing.currency,
          });
        } catch {
          return apiError("internal", "Failed to sync product to Stripe test mode.");
        }
      }

      const updated = await client.mutation(api.products.update, {
        businessId: auth.context.businessId,
        productId: existing._id,
        ...patch,
        stripeProductId: stripeIds?.stripeProductId,
        stripePriceId: stripeIds?.stripePriceId,
      });

      if (!updated) {
        return apiError("not_found", "Product not found.");
      }

      return ok(serializeProduct(updated));
    },
  );
}
