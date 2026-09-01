import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import {
  FULFILLMENT_SIGNATURE_HEADER,
  verifyFulfillmentSignature,
} from "@/lib/fulfillmentHmac";
import { api } from "@/convex/_generated/api";

interface FulfillmentPayload {
  externalOrderId: string;
  [key: string]: unknown;
}

function isFulfillmentPayload(value: unknown): value is FulfillmentPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).externalOrderId === "string"
  );
}

export async function POST(request: NextRequest) {
  const secret = process.env.FULFILLMENT_HMAC_SECRET;
  if (!secret) {
    // Fail closed: an unconfigured deployment must not silently accept writes.
    return NextResponse.json(
      { error: { code: "not_configured", message: "Fulfillment boundary is not configured" } },
      { status: 500 },
    );
  }

  const rawBody = await request.text();
  const signatureHeader = request.headers.get(FULFILLMENT_SIGNATURE_HEADER);
  const valid = await verifyFulfillmentSignature(rawBody, signatureHeader, secret);
  if (!valid) {
    return NextResponse.json(
      { error: { code: "invalid_signature", message: "Missing or invalid signature" } },
      { status: 401 },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "Body must be valid JSON" } },
      { status: 400 },
    );
  }

  if (!isFulfillmentPayload(parsed)) {
    return NextResponse.json(
      { error: { code: "invalid_body", message: "externalOrderId is required" } },
      { status: 400 },
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    // The signature boundary is enforced above regardless of Convex being
    // wired up — see storefront-template/README.md "Known gap".
    return NextResponse.json({ ok: true, recorded: false, reason: "convex_not_configured" });
  }

  try {
    const client = new ConvexHttpClient(convexUrl);
    await client.mutation(api.fulfillmentEvents.record, {
      externalOrderId: parsed.externalOrderId,
      payload: rawBody,
    });
    return NextResponse.json({ ok: true, recorded: true });
  } catch (error) {
    console.error("fulfillment: failed to record event", error);
    return NextResponse.json({ ok: true, recorded: false, reason: "convex_write_failed" });
  }
}
