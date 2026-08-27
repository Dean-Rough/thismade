# Phase 2 gate smoke test (THI-29)

`commerce-e2e.test.ts` proves `PAPERCLIP-GOAL.md`'s Definition-of-done item 4
("sell something") for real, against Stripe's live test-mode API and a real
Convex deployment — not the mocked-boundary unit tests every other
`*.test.ts` in this repo uses. It's excluded from the default `npm test` /
`npx vitest run` (see the `smoke/**` exclusion in `vitest.config.ts`) because
it needs real external setup and makes real network calls. Run it on its own:

```bash
npm run test:e2e
```

It fails loudly and immediately (not a silent skip) if any required setup is
missing, per `PAPERCLIP-GOAL.md`'s "do not fake a pass or stub past the
definition of done silently" rule.

## One-time setup

1. **A Stripe test-mode account.** Free to create, no card required for test
   mode: https://dashboard.stripe.com/register. Grab the test-mode secret key
   (`sk_test_...`) from the dashboard's API keys page — **never** enable or
   copy a live key into this build (`PAPERCLIP-GOAL.md` §Hard constraints).
2. **A deployed Convex project.** `npx convex dev` once, authenticated
   against a real (free) Convex account — this also regenerates
   `convex/_generated/*` for real; see `DECISIONS.md`'s note that those files
   are currently hand-written to match the CLI's own codegen output. Copy the
   resulting `NEXT_PUBLIC_CONVEX_URL` from `.env.local`.
3. **Playwright**, to drive Stripe's real hosted Checkout page (Stripe has no
   API to complete a Checkout Session server-side — this is the standard,
   Stripe-documented way to test it end to end):
   ```bash
   npm install --save-dev playwright
   npx playwright install chromium
   ```
4. **A running instance of this app** with the above Convex URL and Stripe
   key set in its environment (`.env.local`, or your deploy target's env
   vars) — `npm run dev`, or a deployed preview. Also set `STRIPE_WEBHOOK_SECRET`
   on that running instance (see next step).
5. **Webhook delivery to that running instance.** The "order recorded" step
   depends on the real `checkout.session.completed` webhook reaching
   `/api/webhooks/stripe` — nothing in this app polls Stripe directly. For a
   local `npm run dev` instance, use the Stripe CLI:
   ```bash
   stripe login
   stripe listen --forward-to localhost:3000/api/webhooks/stripe --print-secret
   ```
   Set the printed `whsec_...` as `STRIPE_WEBHOOK_SECRET` on the running app
   instance (step 4) and keep `stripe listen` running for the duration of the
   test. For a deployed instance, register a real webhook endpoint in the
   Stripe test-mode dashboard pointing at `<deployed-url>/api/webhooks/stripe`
   instead, and use its signing secret.

## Running it

```bash
export NEXT_PUBLIC_CONVEX_URL="https://your-deployment.convex.cloud"
export SMOKE_API_BASE_URL="http://localhost:3000"   # or a deployed preview URL
export STRIPE_SECRET_KEY="sk_test_..."               # must start with sk_test_
npm run test:e2e
```

The test seeds its own two throwaway businesses + API keys directly via
Convex mutations (mirroring how every other `*.test.ts` in this repo seeds
fixtures), so no manual dashboard setup is needed beyond the account/deploy
steps above.

## What it proves

- Create a product → `PATCH` it `active` (real Stripe test-mode Product +
  Price sync) → `POST /v1/checkout-links` (real hosted Stripe test-mode
  Checkout Session) → a headless browser completes the hosted page with
  Stripe's official test card (`4242 4242 4242 4242`) → the real
  `checkout.session.completed` webhook creates the order row → `POST
  /v1/orders/{id}/refund` succeeds against the real PaymentIntent.
- File upload → `POST /v1/files/complete` → attach the resulting URL to a
  product via `PATCH /v1/products/{id}` → the URL is fetched over the real
  network and returns the uploaded bytes.
- `POST /v1/payouts/onboarding-link` round trip: creates a real test-mode
  Connect Express account and returns a real `https://connect.stripe.com/...`
  onboarding URL; `GET /v1/payouts` reflects the persisted account id.
- Every Phase 2 route with a resource id (products, checkout-links, orders
  get/refund/ship) 404s — never 403s — when a second business's API key
  requests the first business's resource.

## Known limitations / things to check on first live run

- The Checkout-page selectors in `completeHostedCheckout()` were written from
  Stripe's documented field labels/placeholders, not visually verified
  against a live page — this repo's build sandbox has no Stripe credentials.
  If Stripe's Checkout markup has drifted, expect to adjust selectors on the
  first real run.
- No cleanup step deletes the throwaway Stripe test-mode Products/Prices/
  Connect accounts this test creates — harmless in test mode (no real money,
  no real charges), but the test-mode dashboard will accumulate smoke-test
  rows over repeated runs.
