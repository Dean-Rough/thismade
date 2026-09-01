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

## Known gap: per-business Convex provisioning is local-only, not live

Each generated storefront is supposed to get its own **cloud** Convex
deployment (architecture doc: "Generated storefront is its own Next.js +
Convex repo, separate Convex deployment from the platform's"). This
environment's only working Convex credential is `CONVEX_DEPLOY_KEY`, which
is scoped to the **platform's own** dev deployment (`dev:vibrant-gnat-42`)
— it cannot create a new cloud project, and there's no interactive login
available in a headless run.

`scripts/scaffold-storefront.mjs` works around this with
`CONVEX_AGENT_MODE=anonymous npx convex dev --once`, which provisions a
fully local, no-account Convex backend at `http://127.0.0.1:<port>` and
pushes this repo's schema/functions to it. That's real — build, typecheck,
and test all exercise genuine Convex codegen/queries/mutations against it —
but it only runs on the machine that started it and is **not** reachable
once the Next.js app is deployed to Vercel.

Because of that:

- The auth boundaries (`/admin` gate, `/api/fulfillment` HMAC check) are
  fully self-contained and don't depend on any Convex deployment — they
  verify signatures locally and fail closed if their secret env var is
  unset. Both are real and deployable today, independent of this gap.
- In a live deployment, `NEXT_PUBLIC_CONVEX_URL` is left unset (the local
  `http://127.0.0.1:...` URL from scaffolding is dev-only and must not be
  shipped), so `POST /api/fulfillment` responds
  `{ ok: true, recorded: false, reason: "convex_not_configured" }` instead
  of persisting the event — the security boundary is enforced either way;
  the persistence behind it needs a real per-business cloud project first.
- Escalate to whoever manages the `roughton` Convex team for a
  project-creation-scoped deploy key (or run `npx convex login` +
  `convex dev --configure new` interactively, once per business) before
  this gap can close.
