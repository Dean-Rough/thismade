import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { authenticateRequest, requireScope } from "@/lib/api/auth";
import { apiError, ok } from "@/lib/api/envelope";
import { readIdempotencyKey, withIdempotency } from "@/lib/api/idempotency";
import { getConvexServiceSecret } from "@/lib/api/serviceSecret";

const ROUTE = "POST /v1/files";

function getConvexClient(): ConvexHttpClient {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured");
  }
  return new ConvexHttpClient(url);
}

// Returns a signed Convex upload URL plus a businessId-scoped `fileId` the
// caller must send back to `/v1/files/complete`. `fileId` (not the eventual
// storageId) is the tenancy anchor — see convex/files.ts and DECISIONS.md.
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
      const { fileId, uploadUrl } = await client.action(api.filesActions.createPendingUpload, {
        businessId: auth.context.businessId,
        secret: getConvexServiceSecret(),
      });

      return ok({ fileId, uploadUrl }, { status: 201 });
    },
  );
}
