# Build Goal: Internal 1:1 clone of MadeThis ("thismade")

## Mission
Build a working, self-hostable internal clone of the MadeThis "AI co-founder" platform, using the reverse-engineering docs in this folder as the specification. The clone is for internal/personal use only. Reproduce the **architecture, contracts, and behaviour** — never copy MadeThis's proprietary prompt text, copy, or brand assets.

## Source of truth (read first, in this order)
1. `madethis-rebuild-plan v2.md` — the canonical plan (stack, API, IA, flows, phased roadmap, and §8–§9 authenticated deep-dive).
2. `madethis-convex-api-reference.md` — internal Convex function names, args, and response schemas.
3. `madethis-agent-architecture.md` — the agent OS (canonical context files, CEO→worker model, task dispatch, guardrails).
4. `prompts/` — extracted context-file/skill *structure* to learn depth and tone. **Reference for shape only; write original wording.**

If the docs conflict, `v2` wins; if `v2` is silent, use the companion docs; if all are silent, make the simplest choice that matches the observed architecture and record the assumption.

## Definition of done (the finish line)
The clone is "done" when a fresh operator can, on a self-hosted deploy, do all of the following end-to-end, verified by automated tests + a scripted smoke run:
1. **Sign up / sign in** (Clerk or self-hosted auth) and create a **business** (multi-tenant, row-scoped by `businessId`).
2. **Chat to an AI co-founder** that plans work and dispatches it to worker agents, streaming a typed event timeline, with a per-business `MEMORY.md`-style store.
3. **Agents produce a real per-business storefront repo** (Next.js + Convex), build/typecheck/test-gate it, and deploy it to a reachable URL (subdomain).
4. **Sell something:** create a product → generate a hosted Stripe (test-mode) checkout link → complete a test purchase → order recorded → refund works.
5. **Operate:** provision a business inbox and send/receive a thread; create + (dry-run) send an outbound sequence; schedule a social post (stubbed connector OK); create a Meta ad campaign in **sandbox/dev mode**.
6. **Guardrails work:** a spend/consequential action parks in a **confirmation queue** and only executes on approval; **Autopilot** respects a daily credit cap; every write is credit-gated.
7. **Developer surface:** the documented REST `/v1` API is served (business-scoped bearer keys, scopes `read/write/money/ads`, idempotency), an OpenAPI 3.1 doc is generated, and a `thismade mcp` stdio MCP server drives it.

Green = the smoke script exercises 1–7 against a local/staging deploy and the test suite passes. The evaluator is the check command + a fresh-eye review against this list — never the builder judging its own work.

## Architecture (must match the docs)
- **Two backends:** (a) a **Convex** reactive app/agent layer over websocket sync (first-party web/app); (b) the **REST `/v1` API** for developers/agents. They are distinct surfaces — build both.
- **Frontend:** Next.js 15 App Router + React 19 + Tailwind; Clerk auth; PostHog analytics.
- **Agent OS:** canonical context files (SOUL/OWNER/BUSINESS/PLATFORM/PLAYBOOK/RUNBOOK/MEMORY/CODE_MAP) + skills-as-files; CEO orchestrator → `coding`/`browser`/`marketing` workers; kanban task board; typed `richContent` timeline; approval gates.
- **Generated storefronts:** each business = its own Next.js + Convex repo, platform-hosted Stripe Connect checkout (`/checkout/{slug}/{productId}`), `POST /api/fulfillment` HMAC boundary, `/admin` JWT gate. Deploy target = your own Vercel (or self-host).
- **Third parties:** Stripe/Connect (test mode), Meta Marketing API (dev/sandbox), Apollo or a stub for leads, an email provider (AgentMail/Resend/self-host) with warmup, Mux or a stub for video, a sandbox (E2B or containerised) for agent code execution.

## Build order (phased — ship each phase behind a passing gate)
1. **Foundation:** Next.js + Convex + Clerk; `businesses` + `api_keys` + `GET /v1/business`; envelopes (`{data,hint,next_action}` / `{error:{code,message,docs_url}}`) + idempotency middleware.
2. **Commerce MVP:** products → Stripe test checkout → orders (list/get/refund/ship) → files upload → Connect payouts.
3. **Agent core:** Convex WS chat, CEO→worker dispatch, task board, per-business memory + context files, typed timeline, credit ledger gating writes.
4. **Storefront pipeline:** scaffold per-business Next.js+Convex repo → coding agent edits → build/typecheck/test gate → deploy → serve at `{slug}.<yourdomain>`.
5. **Growth surfaces:** email inbox + threads, outbound sequences, social scheduler, Meta ads (sandbox), confirmations + Autopilot caps.
6. **Developer platform:** public REST `/v1`, generated OpenAPI 3.1, scopes, `thismade` CLI + stdio MCP server; impersonation/QA tooling.

## Hard constraints (do not violate)
- **IP:** do not copy MadeThis prompt text, marketing copy, or brand assets. Write original prompts/skills; the `prompts/` folder is a *structural* reference only.
- **Secrets:** never hardcode keys; use env/secret store. Do not commit the HAR files or any captured tokens. Assume all captured MadeThis credentials are already rotated/invalid.
- **No live third-party spend:** Stripe test mode; Meta dev/sandbox; no real ad spend, no real cold email to real people during the build.
- **Isolation:** run agent-generated code only in a sandbox; never on the host.
- **Tenancy:** every read/write is scoped by `businessId`; cross-tenant access returns 404, not 403.
- **Naming:** ship under the project name **thismade** (or your choice) — not "MadeThis".

## Budget & stop rules
- Work phase-by-phase; do not start a phase until the previous phase's gate passes.
- If a phase's acceptance can't be met after a reasonable budget, stop and report the blocker with the specific doc reference and what's missing — do not fake a pass or stub past the definition of done silently (stubs are allowed only where this goal explicitly says "stub/sandbox OK").
- Record every assumption made where the docs were silent in a running `DECISIONS.md`.
