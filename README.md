# thismade

Internal platform foundation. Next.js 15 (App Router) + React 19 + TypeScript + Tailwind, Convex.

Clerk has been removed. The app currently has no app-level auth gate at all —
`/dashboard` renders publicly. Vercel Authentication (deployment protection)
was considered as a replacement gate but is all-or-nothing across the whole
origin, including the public `/v1` Bearer-key API and the Stripe webhook, so
it has not been enabled pending a decision — see `DECISIONS.md`.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Convex values
npx convex dev                # first run: authenticates and generates convex/_generated (see DECISIONS.md)
npm run dev
```

## Scripts

- `npm run dev` — Next.js dev server
- `npm run build` — production build
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — Vitest (Convex function tests via `convex-test`, REST route tests)

## Layout

- `app/v1/**` — REST `/v1` API (Bearer API key auth, `{data,hint,next_action}` / `{error:{code,message,docs_url}}` envelopes)
- `convex/` — schema + Convex functions, `businessId`-scoped from `businesses`/`apiKeys` down
- `lib/api/` — envelope, auth, and Idempotency-Key middleware shared by every `/v1` route
- `DECISIONS.md` — assumptions made where the spec docs were silent
