# shopface frontend design adoption

## Scope and source

This repository owns the MadeThis marketing shell and the server-only conversion ledger. The approved `Dean-Rough/shopface` source was inspected read-only during the implementation, using:

- `Shopface Design System/tokens/colors.css` for the charcoal, lime, stone, slate and sea palette.
- `Shopface Design System/tokens/typography.css` and `tokens/spacing.css` for the tight display type, IBM Plex Mono labels, 8px rhythm, fluid gutters and 44px controls.
- `Shopface Design System/ui_kits/marketing/` for the technical grid, browser-frame, restrained safety state and asymmetric process layout.
- `apps/site/src/brand/shopface-brand.ts` and `packages/email/src/` for the reviewed outreach renderer’s table-email approach and token ownership.

The brand-kit board remains the visual authority: dark technical fields, lime accent, Space Grotesk plus IBM Plex Mono, generous whitespace, disciplined grid cues, and direct Scottish-first language.

## MadeThis storefront

The marketing implementation is in:

- `src/app/globals.css` — semantic Shopface palette mapped into the existing Tailwind tokens, technical grid, preview landscape, selection and focus treatment.
- `src/components/site-header.tsx` and `src/components/site-footer.tsx` — responsive navigation, route-safe offer/FAQ links, approved logo environment variables and the MadeThis footer badge.
- `src/app/page.tsx` — homepage at `/`, including the preview safety band, process, Website + Care offer and FAQ.
- `src/app/(public)/pricing/page.tsx` — `/pricing`, offer detail and FAQ.
- `src/app/(public)/about/page.tsx` — `/about`, safety boundary and offer framing.

Approved public copy is intentionally limited to: “Better sites. Before the pitch.”, Website + Care at `£39/month`, `£29/month` for the first ten customers, the three-month initial term, and quote-first out-of-scope content changes. There are no testimonials, guarantees, delivery-time claims, custom payment fields or automatic sending controls.

## Conversion and checkout boundary

The storefront does not create a checkout URL, expose `SHOPFACE_CONVERSION_HANDOFF_SECRET`, or change the signed handoff contract. `/pricing` explains that checkout follows an approved preview acceptance; the platform checkout URL remains the only permitted eventual payment route. The existing server-only handoff remains the authority for accepted-preview intent.

## Outreach and email boundary

No outreach HTML renderer or reviewed snapshot schema is checked into this repository. The canonical renderer remains in the Astro engine repository at `packages/email/src/` and is responsible for:

- escaping reviewed snapshot fields and sender metadata;
- generating table-based, responsive HTML and plain text together;
- displaying a single preview link without live forms;
- retaining review blockers and a non-sendable state until engine approval.

Accordingly, this storefront does **not** duplicate, invoke, or style a new email renderer. That avoids moving the control plane into the marketing app, inventing prospect fields, or activating delivery. When the engine repository is available for a separate change, apply the same approved dark/lime tokens there while preserving its reviewed `content` input and `sendable: false` review gate. Any future MadeThis notification must use the approved server-side `/site/notify` proxy and a supported event type; no third-party email SDK, API key or client-side secret is permitted.

## Verification

Run from this repository:

```bash
npm run build
npx tsc --noEmit
npm run test:conversion-handoff
```

After publishing, verify `/`, `/pricing` and `/about` at desktop and mobile widths. Confirm the mobile navigation opens, the Website + Care offer is readable, the footer badge remains present, and no page exposes a payment form or a live outreach form.

## Intentionally deferred

- Editing the canonical Astro/Vercel preview renderer and its email templates: they are not present in this repository.
- Activating outreach, a contact/enquiry email adapter, checkout, payment collection, or automatic sending.
- Any request that changes reviewed snapshot facts, preview expiry, `noindex`, no-form controls, human review or the signed conversion-handoff contract.
