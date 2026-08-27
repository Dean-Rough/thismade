/**
 * Live end-to-end smoke test for the Phase 2 Commerce MVP gate (THI-29).
 *
 * Unlike every *.test.ts elsewhere in this repo, this file makes REAL
 * network calls: to a running instance of this app (SMOKE_API_BASE_URL), a
 * real Convex deployment (NEXT_PUBLIC_CONVEX_URL), and Stripe's real
 * test-mode API — including driving an actual hosted Stripe Checkout page
 * with a headless browser and Stripe's official test card. It proves
 * PAPERCLIP-GOAL.md's Definition-of-done item 4 end to end: create a
 * product -> generate a hosted Stripe (test-mode) checkout link -> complete
 * a real test purchase -> order recorded (via the real checkout.session.completed
 * webhook) -> refund works. It also proves the file-upload -> product-deliverable
 * path, the Connect onboarding-link round trip, and that every Phase 2 route
 * 404s (never 403s) on cross-tenant access.
 *
 * This is intentionally NOT part of the default `npx vitest run` / `npm
 * test` (see the `smoke/**` exclusion in vitest.config.ts) — it's the
 * "clearly-documented adjacent script" THI-29 allows for when Stripe's flow
 * doesn't fit vitest's default hermetic-unit-test model. Run it with
 * `npm run test:e2e`. See smoke/README.md for the full runbook (Stripe
 * test-mode account, webhook forwarding, a running dev server, etc).
 *
 * This file fails LOUDLY and immediately if required setup is missing —
 * it must never silently skip and report green. Per PAPERCLIP-GOAL.md
 * §Budget & stop rules: "do not fake a pass or stub past the definition of
 * done silently."
 */
import { ConvexHttpClient } from "convex/browser";
import { beforeAll, describe, expect, it } from "vitest";
import { api } from "@/convex/_generated/api";
import { generateRawApiKey, hashApiKey, visiblePrefix } from "@/convex/lib/apiKeyCrypto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `smoke/commerce-e2e.test.ts requires ${name} to be set — see smoke/README.md for the ` +
        "full runbook. This test refuses to run without it rather than silently skipping " +
        '(PAPERCLIP-GOAL.md: "do not fake a pass or stub past the definition of done silently").',
    );
  }
  return value;
}

const CONVEX_URL = requireEnv("NEXT_PUBLIC_CONVEX_URL");
const API_BASE = requireEnv("SMOKE_API_BASE_URL").replace(/\/$/, "");
const STRIPE_SECRET_KEY = requireEnv("STRIPE_SECRET_KEY");
if (!STRIPE_SECRET_KEY.startsWith("sk_test_")) {
  // Mirrors the same guard every lib/stripe/*.ts file applies server-side —
  // this build never talks to live Stripe, in a test script either.
  throw new Error(
    "STRIPE_SECRET_KEY must be a Stripe test-mode secret key (sk_test_...) to run this smoke test.",
  );
}

type Envelope = { data: any; hint: string | null; next_action: string | null };
type ErrorEnvelope = { error: { code: string; message: string; docs_url: string } };

function idemKey(): string {
  return crypto.randomUUID();
}

async function call(
  path: string,
  opts: { method?: string; bearer: string; body?: unknown; idempotencyKey?: string },
): Promise<{ status: number; body: Envelope & Partial<ErrorEnvelope> }> {
  const headers: Record<string, string> = { authorization: `Bearer ${opts.bearer}` };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.idempotencyKey) headers["idempotency-key"] = opts.idempotencyKey;
  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json();
  return { status: res.status, body };
}

/**
 * Drives Stripe's real hosted Checkout page with a headless browser and
 * Stripe's official always-succeeds test card (4242 4242 4242 4242 —
 * https://stripe.com/docs/testing#cards). Stripe has no API to complete a
 * Checkout Session server-side, so this is the only way to genuinely
 * "complete a test purchase" against the actual hosted-page flow this app
 * generates (as opposed to a lower-level PaymentIntent, which would test a
 * different code path than lib/stripe/checkout.ts).
 *
 * Uses a computed module specifier for the dynamic import so `npm run
 * typecheck` never requires `playwright` to be installed just to type-check
 * this repo — it's only needed at RUN time for this one script. One-time
 * setup: `npm install --save-dev playwright && npx playwright install
 * chromium` (see smoke/README.md).
 *
 * Selectors are best-effort: written from Stripe's documented Checkout
 * fields, but not visually verified against a live page from this sandbox
 * (no Stripe credentials were available while writing this). If Stripe's
 * markup has drifted, the first live run is expected to need selector
 * fixes here.
 */
async function completeHostedCheckout(checkoutUrl: string, email: string): Promise<string> {
  const playwrightModuleSpecifier = "playwright";
  let chromium: { launch: (opts?: unknown) => Promise<any> };
  try {
    ({ chromium } = await import(playwrightModuleSpecifier));
  } catch (err) {
    throw new Error(
      "playwright is not installed. This step drives Stripe's real hosted Checkout page " +
        "with a headless browser. Run: npm install --save-dev playwright && " +
        `npx playwright install chromium — see smoke/README.md.\n\nOriginal error: ${String(err)}`,
    );
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(checkoutUrl, { waitUntil: "domcontentloaded" });

    await page.getByLabel(/email/i).fill(email);
    await page.getByPlaceholder(/card number/i).fill("4242424242424242");
    await page.getByPlaceholder(/mm\s*\/\s*yy/i).fill("12/34");
    await page.getByPlaceholder(/cvc/i).fill("123");
    const nameField = page.getByLabel(/cardholder name/i);
    if (await nameField.count()) await nameField.fill("Smoke Test");
    const postalField = page.getByPlaceholder(/postal code|zip/i);
    if (await postalField.count()) await postalField.fill("94103");

    await page.getByRole("button", { name: /pay/i }).click();
    await page.waitForURL((url: URL) => url.toString().includes("checkout=success"), {
      timeout: 30_000,
    });
    return page.url();
  } finally {
    await browser.close();
  }
}

/**
 * `serializeOrder` (lib/api/orders.ts) doesn't return stripeCheckoutSessionId,
 * so this matches on the (productId, customerEmail) pair we know is unique
 * to this run instead. Polls because order creation happens asynchronously,
 * off the real checkout.session.completed webhook delivery — not a direct
 * consequence of the checkout call.
 */
async function waitForOrder(
  bearer: string,
  match: { productId: string; customerEmail: string },
  timeoutMs = 30_000,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { body } = await call("/v1/orders", { bearer });
    const found = (body.data as any[]).find(
      (o) => o.productId === match.productId && o.customerEmail === match.customerEmail,
    );
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `No order appeared for product ${match.productId} / ${match.customerEmail} within ${timeoutMs}ms. ` +
      "This almost always means the checkout.session.completed webhook never reached " +
      "/api/webhooks/stripe — check that webhook delivery/forwarding is configured for " +
      "SMOKE_API_BASE_URL (e.g. `stripe listen --forward-to`). See smoke/README.md.",
  );
}

let convex: ConvexHttpClient;
let rawKeyA: string;
let rawKeyB: string;
// Populated by the main sell-flow test, consumed by the cross-tenant sweep —
// vitest runs `it`s within one describe in declaration order by default, so
// this ordering dependency is intentional and matches this repo having no
// `test.concurrent` usage anywhere else.
let soldProductId: string;
let soldOrderId: string;

beforeAll(async () => {
  convex = new ConvexHttpClient(CONVEX_URL);
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const businessAId = await convex.mutation(api.businesses.create, {
    name: "Smoke Test Co A",
    slug: `smoke-a-${runId}`,
    ownerUserId: "smoke-test-user-a",
  });
  const businessBId = await convex.mutation(api.businesses.create, {
    name: "Smoke Test Co B",
    slug: `smoke-b-${runId}`,
    ownerUserId: "smoke-test-user-b",
  });

  await convex.mutation(api.businesses.updateCheckoutReturnUrl, {
    businessId: businessAId,
    checkoutReturnUrl: API_BASE,
  });

  rawKeyA = generateRawApiKey("test");
  await convex.mutation(api.apiKeys.create, {
    businessId: businessAId,
    name: "Smoke Test Key A",
    prefix: visiblePrefix(rawKeyA),
    hashedKey: await hashApiKey(rawKeyA),
    scopes: ["read", "write", "money"],
    createdByUserId: "smoke-test-user-a",
  });

  rawKeyB = generateRawApiKey("test");
  await convex.mutation(api.apiKeys.create, {
    businessId: businessBId,
    name: "Smoke Test Key B",
    prefix: visiblePrefix(rawKeyB),
    hashedKey: await hashApiKey(rawKeyB),
    scopes: ["read", "write", "money"],
    createdByUserId: "smoke-test-user-b",
  });
});

describe("Phase 2 gate smoke test (THI-29)", () => {
  it(
    "sells something: product -> hosted checkout -> real test purchase -> order recorded -> refund works",
    async () => {
      const customerEmail = `smoke-buyer-${Date.now()}@example.com`;

      const created = await call("/v1/products", {
        method: "POST",
        bearer: rawKeyA,
        idempotencyKey: idemKey(),
        body: {
          title: "Smoke Test Mug",
          description: "A mug, for testing the Phase 2 gate.",
          priceAmountCents: 1500,
          currency: "usd",
        },
      });
      expect(created.status).toBe(201);
      const productId = created.body.data.id;

      const activated = await call(`/v1/products/${productId}`, {
        method: "PATCH",
        bearer: rawKeyA,
        idempotencyKey: idemKey(),
        body: { status: "active" },
      });
      expect(activated.status).toBe(200);
      // Real Stripe test-mode sync ran — these ids come back from Stripe's
      // actual API, not a mock.
      expect(activated.body.data.stripeProductId).toBeTruthy();
      expect(activated.body.data.stripePriceId).toBeTruthy();

      const checkoutLink = await call("/v1/checkout-links", {
        method: "POST",
        bearer: rawKeyA,
        idempotencyKey: idemKey(),
        body: { productId },
      });
      expect(checkoutLink.status).toBe(201);
      const checkoutUrl: string = checkoutLink.body.data.url;
      expect(checkoutUrl).toMatch(/^https:\/\/checkout\.stripe\.com\//);

      const finalUrl = await completeHostedCheckout(checkoutUrl, customerEmail);
      expect(finalUrl).toContain("checkout=success");

      const order = await waitForOrder(rawKeyA, { productId, customerEmail });
      expect(order.status).toBe("paid");
      expect(order.amountCents).toBe(1500);
      expect(order.currency).toBe("usd");
      expect(order.customerEmail).toBe(customerEmail);

      const refunded = await call(`/v1/orders/${order.id}/refund`, {
        method: "POST",
        bearer: rawKeyA,
        idempotencyKey: idemKey(),
      });
      expect(refunded.status).toBe(200);
      expect(refunded.body.data.status).toBe("refunded");
      expect(refunded.body.data.refundedAt).toBeTruthy();

      soldProductId = productId;
      soldOrderId = order.id;
    },
  );

  it("file upload -> attach to product -> product resolves a working deliverable URL", async () => {
    const created = await call("/v1/files", {
      method: "POST",
      bearer: rawKeyA,
      idempotencyKey: idemKey(),
      body: {},
    });
    expect(created.status).toBe(201);
    const { fileId, uploadUrl } = created.body.data;

    const fileBytes = "smoke test deliverable contents";
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: fileBytes,
    });
    expect(uploadRes.ok).toBe(true);
    const { storageId } = await uploadRes.json();

    const completed = await call("/v1/files/complete", {
      method: "POST",
      bearer: rawKeyA,
      idempotencyKey: idemKey(),
      body: { fileId, storageId },
    });
    expect(completed.status).toBe(200);
    const deliverableUrl: string = completed.body.data.url;

    const product = await call("/v1/products", {
      method: "POST",
      bearer: rawKeyA,
      idempotencyKey: idemKey(),
      body: {
        title: "Smoke Test Digital Download",
        description: "Has a deliverable file.",
        priceAmountCents: 300,
        currency: "usd",
      },
    });
    const productId = product.body.data.id;

    const patched = await call(`/v1/products/${productId}`, {
      method: "PATCH",
      bearer: rawKeyA,
      idempotencyKey: idemKey(),
      body: { deliverableFileUrl: deliverableUrl },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.deliverableFileUrl).toBe(deliverableUrl);

    // The product's deliverableFileUrl genuinely resolves, over the real
    // network — not just a stored string.
    const fetched = await fetch(deliverableUrl);
    expect(fetched.ok).toBe(true);
    expect(await fetched.text()).toBe(fileBytes);
  });

  it("Stripe Connect onboarding-link round trip (test mode)", async () => {
    const link = await call("/v1/payouts/onboarding-link", {
      method: "POST",
      bearer: rawKeyA,
      idempotencyKey: idemKey(),
    });
    expect(link.status).toBe(200);
    expect(link.body.data.url).toMatch(/^https:\/\/connect\.stripe\.com\//);
    expect(link.body.data.expiresAt).toBeGreaterThan(Date.now() / 1000);

    const status = await call("/v1/payouts", { bearer: rawKeyA });
    expect(status.status).toBe(200);
    expect(status.body.data.stripeConnectAccountId).toBeTruthy();
  });

  it("every Phase 2 route 404s (never 403s) on cross-tenant access", async () => {
    if (!soldProductId || !soldOrderId) {
      throw new Error(
        "Requires the main sell-flow test to have run first and populated soldProductId/soldOrderId.",
      );
    }

    const checks: Array<[string, () => Promise<{ status: number; body: any }>]> = [
      ["GET /v1/products/:id", () => call(`/v1/products/${soldProductId}`, { bearer: rawKeyB })],
      [
        "POST /v1/checkout-links",
        () =>
          call("/v1/checkout-links", {
            method: "POST",
            bearer: rawKeyB,
            idempotencyKey: idemKey(),
            body: { productId: soldProductId },
          }),
      ],
      ["GET /v1/orders/:id", () => call(`/v1/orders/${soldOrderId}`, { bearer: rawKeyB })],
      [
        "POST /v1/orders/:id/refund",
        () =>
          call(`/v1/orders/${soldOrderId}/refund`, {
            method: "POST",
            bearer: rawKeyB,
            idempotencyKey: idemKey(),
          }),
      ],
      [
        "POST /v1/orders/:id/ship",
        () =>
          call(`/v1/orders/${soldOrderId}/ship`, {
            method: "POST",
            bearer: rawKeyB,
            idempotencyKey: idemKey(),
            body: { trackingCode: "should-never-apply" },
          }),
      ],
    ];

    for (const [label, run] of checks) {
      const { status, body } = await run();
      expect(status, `${label} should 404 on cross-tenant access, never 403`).toBe(404);
      expect(body.error?.code, `${label} error code`).toBe("not_found");
    }
  });
});
