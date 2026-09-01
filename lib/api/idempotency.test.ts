import { describe, expect, it } from "vitest";
import { readIdempotencyKey, withIdempotency } from "./idempotency";

process.env.CONVEX_SERVICE_SECRET = "test-secret";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://example.com/v1/business", { headers });
}

// Minimal fake satisfying the two `client.action` calls withIdempotency
// makes (idempotencyKeysActions.beginOrReplay/complete — THI-42 moved these
// behind secret-gated actions), in the fixed order it always makes them —
// no need for the full convex/browser mock other route tests use, since
// withIdempotency never touches anything else on the client.
function fakeConvexClient() {
  const calls: Array<{ step: "beginOrReplay" | "complete"; args: any }> = [];
  return {
    calls,
    client: {
      action: async (_fnRef: any, { secret, ...args }: any) => {
        expect(secret).toBe("test-secret");
        if (calls.length === 0) {
          calls.push({ step: "beginOrReplay", args });
          return { outcome: "began" as const, id: "idem_1" };
        }
        calls.push({ step: "complete", args });
        return null;
      },
    } as any,
  };
}

describe("readIdempotencyKey", () => {
  it("rejects a missing header as validation_failed", async () => {
    const result = readIdempotencyKey(requestWith({}));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.response.status).toBe(400);
    const body = await result.response.json();
    expect(body.error.code).toBe("validation_failed");
  });

  it("rejects a key longer than 128 characters", async () => {
    const result = readIdempotencyKey(requestWith({ "idempotency-key": "a".repeat(129) }));
    expect(result.ok).toBe(false);
  });

  it("rejects non-ASCII characters", async () => {
    const result = readIdempotencyKey(requestWith({ "idempotency-key": "café-key" }));
    expect(result.ok).toBe(false);
  });

  it("accepts a well-formed key", () => {
    const result = readIdempotencyKey(requestWith({ "idempotency-key": "order-42-retry-1" }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.key).toBe("order-42-retry-1");
  });
});

describe("withIdempotency", () => {
  it("converts a handler exception into the internal error envelope, and completes (not strands) the claim", async () => {
    const { client, calls } = fakeConvexClient();

    const response = await withIdempotency(client, "business_1" as any, "POST /v1/payouts/onboarding-link", "key-1", "{}", async () => {
      throw new Error("Stripe request to /accounts failed (400): not signed up for Connect");
    });

    expect(response.status).toBe(500);
    const body = await response.clone().json();
    expect(body).toEqual({
      error: {
        code: "internal",
        message: "Stripe request to /accounts failed (400): not signed up for Connect",
        docs_url: "https://docs.thismade.internal/api/errors#internal",
      },
    });

    // The claim must resolve to "completed", not stay stuck "in_progress" —
    // otherwise every future retry with this same key would 409 forever,
    // even though the original request never actually succeeded.
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({
      step: "complete",
      args: { id: "idem_1", responseStatus: 500, responseBody: JSON.stringify(body) },
    });
  });

  it("still returns the handler's own response untouched on success", async () => {
    const { client } = fakeConvexClient();

    const response = await withIdempotency(
      client,
      "business_1" as any,
      "POST /v1/products",
      "key-2",
      "{}",
      async () => new Response(JSON.stringify({ data: { ok: true }, hint: null, next_action: null }), {
        status: 201,
        headers: { "content-type": "application/json" },
      }) as any,
    );

    expect(response.status).toBe(201);
    expect(await response.clone().json()).toEqual({ data: { ok: true }, hint: null, next_action: null });
  });
});
