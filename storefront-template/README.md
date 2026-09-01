# Storefront template

This is the template a fresh per-business storefront repo is scaffolded
from (`scripts/scaffold-storefront.mjs` in the platform repo). It's a
standalone Next.js 15 + Convex app — its own repo, its own Convex
deployment, separate from the platform's.

Do not run `npm run dev` / `npm run gate` / `npx convex ...` directly in
*this* directory against the platform's ambient Convex environment — see
"Known gap" below. Use the scaffold script, which sanitizes the child
process env before invoking Convex.

## What's here

- `middleware.ts` — the `/admin` JWT gate. A `?token=` query param is
  verified (HMAC-SHA256, `lib/adminAuth.ts`) and, if valid, exchanged for an
  HTTP-only `SameSite=Lax` session cookie holding the same token. The cookie
  is re-verified — signature, expiry, and subject — on every subsequent
  `/admin` request. Nothing here trusts the platform's Convex deployment;
  [THI-42](../docs) found that deployment has no auth on any function, so
  this gate must not lean on it.
- `app/api/fulfillment/route.ts` — the `POST /api/fulfillment` HMAC
  boundary (`lib/fulfillmentHmac.ts`). Signature scheme mirrors Stripe
  webhooks: `X-Fulfillment-Signature: t=<unix>,v1=<hex hmac-sha256>` over
  `${t}.${rawBody}`, with a 5-minute replay tolerance.
  Verification happens before the body is parsed or Convex is touched.
- `convex/schema.ts`, `convex/fulfillmentEvents.ts` — minimal Convex schema
  recording accepted fulfillment events. A row here only ever exists because
  the signature above already checked out.
- `app/`, `lib/` — a placeholder home page and the auth primitives above.

## Required environment

See `environment.example` (named without a leading `.` so the platform
repo's blanket `.env*` gitignore rule doesn't hide it — see that repo's
`.gitignore`). `scripts/scaffold-storefront.mjs` fills in
`BUSINESS_SLUG`, `ADMIN_JWT_SECRET`, and `FULFILLMENT_HMAC_SECRET`
automatically with fresh per-business values.

## Known gap: per-business Convex provisioning

Each generated storefront is supposed to get its own Convex deployment
(architecture doc: "Generated storefront is its own Next.js + Convex repo,
separate Convex deployment from the platform's"). This environment's only
working Convex credential is `CONVEX_DEPLOY_KEY`, which is scoped to the
**platform's own** dev deployment (`dev:vibrant-gnat-42`) — it cannot create
a new project. Provisioning a new Convex cloud project requires either an
interactive `npx convex login` + `convex dev --configure=new`, or a
team-scoped (project-creation) API token, neither of which is available in
this headless run.

Because of that:

- The auth boundaries (`/admin` gate, `/api/fulfillment` HMAC check) are
  fully self-contained and don't depend on a live Convex deployment — they
  verify signatures locally and fail closed if their secret env var is
  unset. Both are testable and deployable today.
- `convex/schema.ts` + `convex/fulfillmentEvents.ts` are real, typechecked,
  tested (via `convex-test`, no live backend needed) Convex code, and
  `convex codegen` runs locally without a deployment. But until a business
  gets its own Convex project, `POST /api/fulfillment` responds
  `{ ok: true, recorded: false, reason: "convex_not_configured" }` instead
  of persisting the event — the security boundary is real, the persistence
  behind it is not yet wired to a live per-business backend.
- Escalate to whoever manages the `roughton` Convex team for a
  project-creation-scoped token (or run the one-time interactive
  provisioning step per business) before this gap can close.
