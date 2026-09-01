import { describe, expect, it } from "vitest";
import { signFulfillmentPayload, verifyFulfillmentSignature } from "./fulfillmentHmac";

const SECRET = "test-fulfillment-secret";
const BODY = JSON.stringify({ externalOrderId: "order_123", status: "paid" });

describe("fulfillment HMAC boundary", () => {
  it("accepts a correctly signed request", async () => {
    const header = await signFulfillmentPayload(BODY, SECRET);
    await expect(verifyFulfillmentSignature(BODY, header, SECRET)).resolves.toBe(true);
  });

  it("rejects a missing signature header", async () => {
    await expect(verifyFulfillmentSignature(BODY, null, SECRET)).resolves.toBe(false);
  });

  it("rejects a malformed signature header", async () => {
    await expect(verifyFulfillmentSignature(BODY, "not-a-signature", SECRET)).resolves.toBe(false);
    await expect(verifyFulfillmentSignature(BODY, "t=abc,v1=zz", SECRET)).resolves.toBe(false);
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const header = await signFulfillmentPayload(BODY, "a-different-secret");
    await expect(verifyFulfillmentSignature(BODY, header, SECRET)).resolves.toBe(false);
  });

  it("rejects a signature whose body was tampered with after signing", async () => {
    const header = await signFulfillmentPayload(BODY, SECRET);
    const tamperedBody = JSON.stringify({ externalOrderId: "order_123", status: "refunded" });
    await expect(verifyFulfillmentSignature(tamperedBody, header, SECRET)).resolves.toBe(false);
  });

  it("rejects a stale timestamp outside the replay tolerance", async () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;
    const header = await signFulfillmentPayload(BODY, SECRET, tenMinutesAgo);
    await expect(verifyFulfillmentSignature(BODY, header, SECRET)).resolves.toBe(false);
  });

  it("accepts a timestamp within tolerance", async () => {
    const oneMinuteAgo = Math.floor(Date.now() / 1000) - 60;
    const header = await signFulfillmentPayload(BODY, SECRET, oneMinuteAgo);
    await expect(verifyFulfillmentSignature(BODY, header, SECRET)).resolves.toBe(true);
  });
});
