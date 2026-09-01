import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { FULFILLMENT_SIGNATURE_HEADER, signFulfillmentPayload } from "@/lib/fulfillmentHmac";

const SECRET = "route-test-secret";
const BODY = JSON.stringify({ externalOrderId: "order_route_test" });

function postRequest(body: string, signature: string | null): NextRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set(FULFILLMENT_SIGNATURE_HEADER, signature);
  return new NextRequest("https://storefront.example/api/fulfillment", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/fulfillment", () => {
  const originalSecret = process.env.FULFILLMENT_HMAC_SECRET;
  const originalConvexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  beforeEach(() => {
    process.env.FULFILLMENT_HMAC_SECRET = SECRET;
    delete process.env.NEXT_PUBLIC_CONVEX_URL;
  });

  afterEach(() => {
    process.env.FULFILLMENT_HMAC_SECRET = originalSecret;
    process.env.NEXT_PUBLIC_CONVEX_URL = originalConvexUrl;
  });

  it("rejects a request with no signature header", async () => {
    const response = await POST(postRequest(BODY, null));
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json.error.code).toBe("invalid_signature");
  });

  it("rejects a request with an invalid signature", async () => {
    const response = await POST(postRequest(BODY, "t=1,v1=00"));
    expect(response.status).toBe(401);
  });

  it("accepts a validly signed request and reports Convex is not configured", async () => {
    const signature = await signFulfillmentPayload(BODY, SECRET);
    const response = await POST(postRequest(BODY, signature));
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toEqual({ ok: true, recorded: false, reason: "convex_not_configured" });
  });

  it("fails closed when the boundary secret itself is unconfigured", async () => {
    delete process.env.FULFILLMENT_HMAC_SECRET;
    const signature = await signFulfillmentPayload(BODY, SECRET);
    const response = await POST(postRequest(BODY, signature));
    expect(response.status).toBe(500);
  });
});
