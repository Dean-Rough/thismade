import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";
import { readIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { getConvexServiceSecret } from "@/lib/api/serviceSecret";

const ROUTE = "POST /v1/files/complete";

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
      if (typeof body.fileId !== "string" || body.fileId.length === 0) {
        return apiError("validation_failed", "fileId must be a non-empty string.");
      }
      if (typeof body.storageId !== "string" || body.storageId.length === 0) {
        return apiError("validation_failed", "storageId must be a non-empty string.");
      }

      // A cross-tenant fileId (someone else's pending upload) must 404, never
      // 403 — enforced inside files.completeUpload via convex/lib/tenancy.ts.
      const result = await client.action(api.filesActions.completeUpload, {
        businessId: auth.context.businessId,
        fileId: body.fileId as never,
        storageId: body.storageId as never,
        secret: getConvexServiceSecret(),
      });

      if (!result) {
        return apiError("not_found", "File not found.");
      }

      return ok({ fileId: result.fileId, url: result.url });
    },
  );
}
