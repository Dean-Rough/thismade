# Exception-only conversion handoff

## Purpose

The shopface engine remains canonical for discovery, scoring, verified fact snapshots, preview generation, human review, private delivery, expiry and teardown. This Convex slice is a server-only conversion ledger after intent. It does not replace the engine, render previews, send routine mail, create checkouts, or take payments.

## Automated lifecycle

1. The engine sends a signed `preview.sent` event only after all eight review/safety booleans are true and immutable preview/snapshot/expiry data is present.
2. The server persists one handoff plus an audit event. A failed gate opens a `safety_or_quality_check_failure` exception instead of recording a valid sent preview.
3. A signed `intent.enquiry` records intent and a standard-reply action with status `disabled`. It is durable, but no email is sent until a separately approved adapter is configured.
4. A signed `intent.accept` creates `pending_conversion`, reserves the first-ten price atomically (`£29/month` for the first 10 pending conversions, otherwise `£39/month`), and records a three-month initial term. `paymentStatus` remains `not_started`; this integration creates no payment or checkout.
5. Routine successful events create no notifications. Only open exceptions belong in the operator queue.

## Event contract

`POST /api/conversion-handoff` is a Convex HTTP route intended only for the engine. Sign the exact raw JSON UTF-8 body with HMAC-SHA256 and send the lowercase hexadecimal digest as `X-Shopface-Handoff-Signature`.

Required envelope:

```json
{
  "version": "2026-08-25",
  "eventId": "engine event UUID",
  "idempotencyKey": "stable retry key",
  "type": "preview.sent | intent.enquiry | intent.accept | exception.reported",
  "occurredAt": 1780000000000,
  "payload": { "prospectId": "...", "previewId": "..." }
}
```

`preview.sent` also requires `previewUrl`, `snapshotReference`, `snapshotHash`, `expiresAt`, and `review` containing `claimsApproved`, `imagesApproved`, `layoutApproved`, `safetyChecksPassed`, `noIndex`, `clearlyUnofficial`, `noLiveForms`, and `outboundApproved`, all `true`.

`exception.reported` requires a supported `exceptionCode`. Optional free text is capped server-side; do not include credentials, raw scraping material, payment data, or broad customer data.

The ledger keys the replay guard on `idempotencyKey`. Retries increment `deliveryAttempts` without creating a second handoff, offer, or exception. A second accept with a new key preserves an existing pending conversion and its recorded offer.

## Exception queue

Only these states require Dean:

- `missing_or_conflicting_public_facts`
- `safety_or_quality_check_failure`
- `preview_expiry_or_teardown_failure`
- `unclear_scope_or_content_request`
- `payment_or_checkout_issue`
- `bounce_or_complaint`
- `non_standard_commercial_request`

Open items are in `conversionExceptions` with `status: "open"`. `notificationStatus: "disabled"` is intentional until an approved exception-only notification adapter exists. There are no notifications for normal sends, enquiries, accepts, or retries.

## Environment variables

- `SHOPFACE_CONVERSION_HANDOFF_SECRET` — required server-side HMAC secret for engine events.
- `PLATFORM_AUTH_EMAIL_URL` — reserved for an explicitly approved future exception notification adapter.
- `PLATFORM_FULFILLMENT_SECRET` — existing platform fulfillment webhook secret; do not reuse it for the handoff.

No browser variable, Stripe key, email-provider key, or custom card form is used.

## Test and rollback

- Run `npm run test:conversion-handoff`, `npm run build`, and `npx tsc --noEmit`.
- Test the route from a server-side fixture only, signing the exact body. Verify a retry returns `duplicate: true` and does not create a second conversion event.
- To pause intake, remove `SHOPFACE_CONVERSION_HANDOFF_SECRET`; the route returns `503` and writes nothing. To roll back records, disable the caller first, then use a reviewed internal data migration—do not delete live preview records or bypass engine-owned expiry/teardown.
- Do not enable outbound email or checkout based on this document alone. The owner/platform must approve the product, checkout path, reply content, and exception recipient before an adapter is enabled.
