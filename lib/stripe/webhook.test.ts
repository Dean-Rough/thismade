import { describe, expect, it } from "vitest";
import { StripeSignatureError, constructStripeEvent } from "./webhook";

const SECRET = "whsec_test_fake";

async function sign(payload: string, timestampSeconds: number, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestampSeconds}.${payload}`),
  );
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${timestampSeconds},v1=${hex}`;
}

describe("constructStripeEvent", () => {
  it("rejects a missing Stripe-Signature header", async () => {
    await expect(constructStripeEvent("{}", null, SECRET)).rejects.toThrow(StripeSignatureError);
  });

  it("rejects a malformed header missing t= or v1=", async () => {
    await expect(constructStripeEvent("{}", "garbage", SECRET)).rejects.toThrow(
      /Malformed Stripe-Signature/,
    );
  });

  it("rejects a signature computed with the wrong secret", async () => {
    const payload = JSON.stringify({ id: "evt_1", type: "account.updated", data: { object: {} } });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = await sign(payload, nowSeconds, "whsec_wrong_secret");
    await expect(constructStripeEvent(payload, header, SECRET)).rejects.toThrow(
      /verification failed/,
    );
  });

  it("rejects a signature computed over a different payload (tamper detection)", async () => {
    const original = JSON.stringify({ id: "evt_1", type: "account.updated", data: { object: {} } });
    const tampered = JSON.stringify({ id: "evt_1", type: "account.updated", data: { object: { evil: true } } });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = await sign(original, nowSeconds);
    await expect(constructStripeEvent(tampered, header, SECRET)).rejects.toThrow(
      /verification failed/,
    );
  });

  it("rejects a timestamp outside the tolerance window (replay protection)", async () => {
    const payload = JSON.stringify({ id: "evt_1", type: "account.updated", data: { object: {} } });
    const staleSeconds = Math.floor(Date.now() / 1000) - 3600;
    const header = await sign(payload, staleSeconds);
    await expect(constructStripeEvent(payload, header, SECRET)).rejects.toThrow(/tolerance/);
  });

  it("accepts a validly signed, fresh payload and returns the parsed event", async () => {
    const account = {
      id: "acct_test_123",
      details_submitted: true,
      charges_enabled: true,
      payouts_enabled: false,
    };
    const payload = JSON.stringify({ id: "evt_1", type: "account.updated", data: { object: account } });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = await sign(payload, nowSeconds);

    const event = await constructStripeEvent(payload, header, SECRET);

    expect(event.type).toBe("account.updated");
    expect(event.data.object).toEqual(account);
  });
});
