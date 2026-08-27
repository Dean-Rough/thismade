import { ConvexHttpClient } from "convex/browser";
import { NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { apiError } from "./envelope";

const MIN_LEN = 1;
const MAX_LEN = 128;
// 1-128 ASCII characters, per madethis-rebuild-plan.md §3 Idempotency Protection.
const ASCII_ONLY = /^[\x21-\x7e]+$/;

export type IdempotencyCheck =
  | { ok: true; key: string }
  | { ok: false; response: NextResponse };

export function readIdempotencyKey(req: Request): IdempotencyCheck {
  const key = req.headers.get("idempotency-key");
  if (!key) {
    return {
      ok: false,
      response: apiError(
        "validation_failed",
        "Idempotency-Key header is required for this mutation endpoint.",
      ),
    };
  }
  if (key.length < MIN_LEN || key.length > MAX_LEN || !ASCII_ONLY.test(key)) {
    return {
      ok: false,
      response: apiError(
        "validation_failed",
        "Idempotency-Key must be 1-128 ASCII characters.",
      ),
    };
  }
  return { ok: true, key };
}

async function hashBody(rawBody: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawBody));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Wraps a mutation route handler so a duplicate request (same business,
 * route, Idempotency-Key) replays the first response instead of re-running
 * the mutation, and a key reused with a different body is rejected outright.
 * A key currently mid-flight also 409s, per the documented
 * `idempotency_conflict` semantics for concurrent identical requests.
 */
export async function withIdempotency(
  client: ConvexHttpClient,
  businessId: Id<"businesses">,
  route: string,
  idempotencyKey: string,
  rawBody: string,
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  const requestHash = await hashBody(rawBody);

  const claim = await client.mutation(api.idempotencyKeys.beginOrReplay, {
    businessId,
    route,
    key: idempotencyKey,
    requestHash,
  });

  if (claim.outcome === "conflict") {
    return apiError(
      "idempotency_conflict",
      "This Idempotency-Key is already in progress or was used with a different request body.",
    );
  }

  if (claim.outcome === "replay") {
    return new NextResponse(claim.responseBody, {
      status: claim.responseStatus,
      headers: { "content-type": "application/json" },
    });
  }

  const recordId = claim.id;
  const response = await handler();
  const responseBody = await response.clone().text();

  await client.mutation(api.idempotencyKeys.complete, {
    id: recordId,
    responseStatus: response.status,
    responseBody,
  });

  return response;
}
