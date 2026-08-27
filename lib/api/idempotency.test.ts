import { describe, expect, it } from "vitest";
import { readIdempotencyKey } from "./idempotency";

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://example.com/v1/business", { headers });
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
