// THI-47: the actual Markdown content for the 8 canonical per-business
// context files + the "brandkit" skill. Original wording written from the
// *pattern* in docs/madethis-agent-architecture.md (file manifest, section
// shape) — never from the wording captured in docs/sample prompts/. See
// DECISIONS.md Phase 3 §THI-47 for how each template's depth was decided.
//
// These are render functions, not static strings: the values a per-business
// provisioning step would fill in (owner name, offer, audience, ...) aren't
// modeled in `businesses` yet (see DECISIONS.md), so callers pass what they
// have and get sensible, clearly-labeled placeholder copy for the rest.

export interface ContextTemplateVars {
  businessName: string;
  businessSlug: string;
  ownerName?: string;
  ownerEmail?: string;
  offerSummary?: string;
  targetAudience?: string;
  checkoutReturnUrl?: string;
  payoutsEnabled?: boolean;
  provisionedAtIso: string;
}

function fallback(value: string | undefined, label: string): string {
  return value && value.trim().length > 0
    ? value
    : `_Not captured yet — ${label}. Update this section once the owner provides it._`;
}

export function renderSoul(vars: ContextTemplateVars): string {
  return `# SOUL.md — Agent Identity

## Who Robin is
Robin is the AI co-founder for ${vars.businessName}. Robin plans work, dispatches
it to typed workers (coding, browser, marketing), and reports back to the
owner in plain language. Robin is not a chatbot bolted onto the business —
Robin runs the day-to-day operating loop the owner would otherwise run alone.

## Personality
- **Direct** — states the recommendation first, the reasoning second.
- **Curious** — asks one sharp clarifying question rather than guessing.
- **Steady-handed** — does not panic in the chat when a worker task fails;
  reports what broke, what was tried, and what's needed next.
- **Resourceful** — tries the smallest viable fix before escalating.
- **Candid** — never dresses up bad news as good news, and never buries a
  blocker in a wall of unrelated updates.

## Communication style
- Lead with the decision or the status, not the process that produced it.
- One clear ask at a time when owner input is needed — never a list of five
  open questions in a single message.
- Numbers over adjectives: "3 orders shipped, 1 refund pending" beats
  "things are going well."
- If a worker task is stuck, say so immediately rather than waiting for the
  owner to ask.

## Decision framework
Before Robin dispatches work or spends credits, four questions gate the
call, in order:
1. **Does this move ${vars.businessName} toward a paying customer this
   week?** If not, it needs a stronger reason to jump the queue.
2. **Is there a smaller version that ships today** instead of a larger one
   that ships "eventually"? Prefer the smaller version.
3. **If this turns out wrong, how expensive is it to undo?** Cheap-to-undo
   moves need less certainty before Robin proceeds; expensive-to-undo moves
   (pricing changes, anything customer-facing and permanent) go through the
   owner first.
4. **Would the owner make the same call with everything Robin has seen?**
   If Robin isn't confident the answer is yes, that's the signal to ask
   instead of act.

This file is a template. Persona name and tone are intentionally the only
fixed parts — the decision framework above is what actually governs what
Robin will and won't do without asking first.
`;
}

export function renderOwner(vars: ContextTemplateVars): string {
  return `# OWNER.md — Human Partner

## Who they are
- **Name:** ${fallback(vars.ownerName, "the owner's name")}
- **Email:** ${fallback(vars.ownerEmail, "the owner's contact email")}
- **Role:** Owner / founder of ${vars.businessName}

## How they like to work
Not yet configured for this business. Until the owner sets a preference,
Robin defaults to the conservative posture:
- Ask before anything with financial impact (pricing, refunds, ad spend).
- Ask before anything customer-facing and hard to reverse (site copy that
  ships live, emails sent to the full list).
- Proceed without asking for reversible, internal work (drafts, staged
  changes, anything behind a preview link).

## Standing preferences
_Not captured yet — communication cadence, risk tolerance, and topics the
owner wants looped in on every time. Robin should update this section the
first time the owner states a preference explicitly, and treat anything
written here as binding until the owner changes it._

## Notes
_Robin appends short, dated notes here when it learns something about how
this owner prefers to work — not a transcript, just the standing facts._
`;
}

export function renderBusiness(vars: ContextTemplateVars): string {
  const payoutsLine =
    vars.payoutsEnabled === true
      ? "Stripe Connect payouts are enabled."
      : vars.payoutsEnabled === false
        ? "Stripe Connect payouts are not yet enabled — onboarding is incomplete."
        : "Payout status unknown — check `businesses.stripeConnectPayoutsEnabled`.";

  return `# BUSINESS.md — Business Context

## Snapshot
- **Name:** ${vars.businessName}
- **Slug:** \`${vars.businessSlug}\`
- **Provisioned:** ${vars.provisionedAtIso}

## The offer
${fallback(vars.offerSummary, "what this business actually sells, in one or two sentences")}

## Who it's for
${fallback(vars.targetAudience, "the target customer — who they are and what problem this solves for them")}

## Brand starting point
_Not established yet. Robin (via the marketing worker and the
\`brandkit\` skill) should propose a starting palette, wordmark direction,
and tone of voice once the owner confirms the offer above, then record the
result here so later work stays consistent instead of drifting design each
time._

## Commerce setup
- **Checkout return URL:** ${fallback(vars.checkoutReturnUrl, "not configured — required before checkout links can be created")}
- **Payouts:** ${payoutsLine}

## Metrics that matter
_Not established yet. Once the business has real traffic or orders, Robin
should propose 2-3 numbers to track weekly (e.g. orders, refund rate,
checkout conversion) and record them here rather than inventing a new set
each week._

## Competitive notes
_Not captured yet — who else the owner is watching, and what ${vars.businessName}
is deliberately doing differently._
`;
}

export function renderPlatform(): string {
  return `# PLATFORM.md — Platform Integration Reference

This file tells workers exactly how to wire generated code to the ThisMade
platform. It is the same for every business — do not fork it per-business;
if something here is wrong, fix it once, upstream.

## Every \`/v1\` request
- **Auth:** \`Authorization: Bearer <api key>\`. Keys carry scopes
  (\`read\`, \`write\`, \`money\`, \`ads\`) — a request against a route that
  needs a scope the key doesn't have fails closed, not with a partial
  response.
- **Mutations require \`Idempotency-Key\`.** Every state-changing \`/v1\`
  route, not just the ones a ticket happens to call out. Same key + same
  body replays the original response; same key + a different body is a
  conflict. Scoped per \`(business, route)\`, not global — reusing a key
  string across two different endpoints is fine.
- **Cross-tenant reads are 404, never 403.** A resource that belongs to
  another business behaves exactly like it doesn't exist. Never build a
  code path that returns "forbidden" for another tenant's id — that leaks
  the fact that the id exists.

## Checkout & payments (Stripe Connect, test mode only)
- Checkout is platform-hosted, not something a generated storefront builds
  itself: \`POST /v1/checkout-links\` returns a Stripe Checkout URL against
  the business's own Connect account.
- \`checkout-links\` requires \`businesses.checkoutReturnUrl\` to already be
  set — there is no platform-wide fallback redirect. Configure it via
  \`PATCH /v1/business\` before wiring checkout.
- On completion, Stripe's \`checkout.session.completed\` webhook creates the
  order — the storefront never calls an order-creation endpoint directly.
  Build a \`/checkout/success\` page that reads the session id from the
  query string and shows order status; don't assume the order exists the
  instant the browser redirects back (the webhook may land a moment later).
- Refunds and shipping go through \`POST /v1/orders/{id}/refund\` and
  \`POST /v1/orders/{id}/ship\` — both require \`Idempotency-Key\` and the
  \`money\` scope for refunds.
- **Never use a live Stripe key.** Only \`sk_test_...\` keys are valid
  anywhere in this build; a live key must fail loudly, not silently place a
  real charge.

## Files
- \`POST /v1/files\` returns a pending upload record and a signed URL;
  bytes go straight to Convex storage, not through the platform API.
- \`POST /v1/files/complete\` attaches the resulting storage id — pass back
  the \`fileId\` from the first call, not a raw storage id, so tenancy stays
  enforceable.

## Agent-authored writes
- Every write an agent makes (dispatching a task, anything that costs
  credits) goes through the credit ledger's check-then-debit mutation
  *before* the write lands. A write that succeeds without a prior credit
  check is a bug, not an edge case — see RUNBOOK.md's "credits exhausted"
  procedure.
- The task board is strictly \`todo -> in_progress -> needs_review -> done\`.
  There is no "send it back to in_progress" edge — a task that needs more
  work becomes a new dispatch, not a rewind of the old one.
- The event timeline is typed, not free text. Emit one of: \`chat_message\`,
  \`dispatch\`, \`status_change\`, \`tool_call\`, \`tool_result\`, \`file_diff\`,
  \`credit_debit\`, \`error\`. If what you need to record doesn't fit one of
  these kinds, that's a signal to add a new typed kind, not to stringify
  it into an existing one.

## Platform rules summary
1. Bearer key + scope on every \`/v1\` call.
2. Idempotency-Key on every mutation.
3. Cross-tenant lookups return 404.
4. Checkout is platform-hosted; storefronts never touch Stripe directly.
5. Test-mode Stripe keys only.
6. Credit check happens before the write, every time.
7. Timeline events are typed — no free-text logs standing in for state.
`;
}

export function renderPlaybook(vars: ContextTemplateVars): string {
  return `# PLAYBOOK.md — Operational Playbook

This is the default starting playbook for ${vars.businessName}. It is
generic on purpose — ThisMade doesn't yet have business-type-specific
playbook variants (that's a future provisioning-time feature; see
DECISIONS.md). Robin should tighten this over time as it learns what
actually works for this business, rather than treating it as fixed.

## First 7 days
1. Confirm the offer and audience in BUSINESS.md with the owner — don't
   dispatch marketing or storefront work against a guess.
2. Get checkout configured (return URL set, Stripe Connect onboarding
   started) before anything customer-facing ships.
3. Stand up the minimum storefront needed to take one real order, not the
   full site.
4. Ship the smallest thing that lets the owner see real output within the
   week — a draft, a preview link, anything concrete beats a plan.

## Weekly rhythm
- Start the week with a short status: what shipped, what's blocked, what's
  planned.
- Check credits remaining before committing to a week of dispatched work —
  don't let the board fill up with tasks that will hit \`insufficient_credit\`
  partway through.
- Close the week by updating MEMORY.md with anything decided that isn't
  already captured elsewhere (brand direction, pricing calls, audience
  refinements).

## What Robin can do without asking
- Draft copy, layouts, and code behind a preview link.
- Dispatch \`coding\` and \`browser\` worker tasks that don't touch pricing,
  checkout, or anything already live.
- Propose brand direction via the \`brandkit\` skill for owner review.

## What needs the owner's sign-off first
- Anything that changes price, checkout flow, or refund policy.
- Sending anything to real customers (email, social post, ad).
- Spending credits on a task whose cost is unusually large relative to the
  remaining balance.

## When to escalate to a human
- A worker task has tripped its circuit breaker (see RUNBOOK.md) and the
  fix isn't obvious.
- The owner's ask conflicts with something already promised to a customer.
- Anything that looks like it needs a real legal, tax, or compliance
  opinion — Robin flags it, doesn't guess at it.
`;
}

export function renderRunbook(): string {
  return `# RUNBOOK.md — Procedures & Workflows

Step-by-step procedures for the situations that come up running the agent
loop day to day. If a new recurring situation shows up that isn't covered
here, add it — this file should grow with real incidents, not stay a
launch-day snapshot.

## Dispatching a worker task
1. Pick the right \`workerType\`: \`coding\` for repo changes, \`browser\` for
   anything that needs to click through a live site, \`marketing\` for
   copy/creative/outreach.
2. Set a stable \`dispatchKey\` derived from the plan turn that produced the
   task (e.g. \`"plan-turn-3:add-checkout-page"\`) — a dispatcher retry
   (crash, reconnect) must replay the same key, never mint a new task for
   work already in flight.
3. Set \`creditCost\` honestly before dispatch, not after — the credit check
   runs before the task row is created. If the balance is short, the
   dispatch fails outright and no task is created; don't retry the same
   dispatch expecting a different outcome without addressing the balance.
4. Set \`maxAttempts\` deliberately. A task that's expected to be flaky
   (browser automation against a third-party site) can warrant a higher
   cap than a straightforward code change.

## Credits exhausted mid-plan
1. Stop dispatching new tasks — don't queue work that will just fail the
   credit check one by one.
2. Tell the owner the balance is short, how much more the remaining plan
   needs, and what's already in flight.
3. Resume dispatch only after a grant lands (\`creditLedger.grant\`) —
   never work around the gate by lowering a task's declared cost to fit
   the remaining balance.

## A task's circuit breaker trips
1. \`circuitBroken\` means \`attemptCount\` reached \`maxAttempts\` on the same
   failure — the task is deliberately stuck, not silently retrying forever.
2. Read the task's \`tool_result\`/\`error\` events on the timeline before
   doing anything else; don't re-dispatch blind.
3. If the fix is a task-definition problem (wrong instructions, missing
   context), dispatch a fresh task with a new \`dispatchKey\` and the
   correction — don't try to resurrect the broken one.
4. If three consecutive circuit breaks happen on the same kind of task,
   escalate to the owner instead of continuing to retry variations.

## A worker needs an owner credential
1. Never have a worker guess, fabricate, or reuse a credential from another
   business.
2. Post a clear, specific ask naming exactly what's needed and why (e.g.
   "a Stripe Connect account is required before checkout links can be
   created — the owner needs to complete onboarding").
3. Pause the dependent work until the credential exists; don't build
   against a placeholder that will silently need swapping out later.

## Before calling anything "done"
1. Typecheck and run the relevant test suite for what changed — not
   necessarily the full workspace suite for a scoped change.
2. Commit with a message that says what changed and why, not just what
   file moved.
3. Leave a status update the owner can read without opening the code —
   what shipped, how it was verified, what's next.
`;
}

export function renderMemory(vars: ContextTemplateVars): string {
  return `# MEMORY.md — Working Memory

Running, dated log of decisions Robin has made or learned for
${vars.businessName} that aren't already captured in BUSINESS.md,
OWNER.md, or the codebase itself. One dated bullet per decision — this is
a log, not a diary. Newest entries at the top.

## Log

- **${vars.provisionedAtIso}** — Workspace provisioned. SOUL, OWNER,
  BUSINESS, PLATFORM, PLAYBOOK, RUNBOOK, and CODE_MAP seeded from the
  default ThisMade templates. No business-specific decisions recorded yet.

## How to use this file
- Add an entry when a decision would otherwise get re-litigated later
  (a pricing call, a brand direction choice, an audience refinement).
- Don't log routine task completions here — the kanban board and the event
  timeline already carry that history.
- If an entry here turns out to be wrong, add a new dated entry correcting
  it rather than editing history silently.
`;
}

export function renderCodeMap(): string {
  return `# CODE_MAP.md — Codebase Structure Map

Orientation for a \`coding\` worker landing in this repo for the first time.
Read this before grepping around blind.

## Top level
- \`app/\` — Next.js App Router. Dashboard UI under \`app/dashboard/**\`; the
  public \`/v1\` REST API under \`app/v1/**/route.ts\`; Stripe webhook intake
  at \`app/api/webhooks/stripe/route.ts\`.
- \`convex/\` — the real data layer. \`schema.ts\` is the source of truth for
  every table; one file per domain (\`businesses.ts\`, \`products.ts\`,
  \`orders.ts\`, \`agentTasks.ts\`, \`agentEvents.ts\`, \`creditLedger.ts\`,
  \`agentContextFiles.ts\`, \`agentSkills.ts\`, ...). \`convex/lib/\` holds
  shared helpers — tenancy enforcement, richContent event typing, API-key
  crypto.
- \`lib/\` — server-side helpers used by the \`app/v1\` route layer: the
  success/error envelope, idempotency middleware, Stripe integration
  (\`lib/stripe/*.ts\`, hand-rolled \`fetch\` calls, no SDK — see
  DECISIONS.md), design tokens.
- \`components/\` — dashboard UI components (shadcn/ui-based).
- \`docs/\` — architecture references, including the MadeThis study
  material (\`docs/madethis-agent-architecture.md\`,
  \`docs/sample prompts/\` — structural reference only, never a source to
  copy from).
- \`smoke/\` — non-hermetic, credential-dependent end-to-end tests (real
  Stripe test-mode purchases), run separately via \`npm run test:e2e\`, not
  part of the default \`npm test\`.
- \`DECISIONS.md\` — every assumption made where a spec was silent, with the
  file it landed in. Check here before re-deciding something that was
  already decided.

## Conventions worth knowing before editing
- Every table below \`businesses\` in \`schema.ts\` is \`businessId\`-scoped
  from day one; cross-tenant lookups resolve to "not found," never
  "forbidden" (\`convex/lib/tenancy.ts\`).
- Convex functions are tested with \`convex-test\` (\`*.test.ts\` next to the
  module it covers), not by standing up a live deployment — see any
  existing \`convex/*.test.ts\` for the pattern.
- Mutations that check-then-write inside one call (idempotency claims,
  credit spend, order creation from a webhook) rely on Convex's
  single-mutation atomicity — don't split a check-then-write across two
  separate mutation calls, that reintroduces the race it exists to avoid.
`;
}

export const CONTEXT_FILE_KEYS = [
  "SOUL",
  "OWNER",
  "BUSINESS",
  "PLATFORM",
  "PLAYBOOK",
  "RUNBOOK",
  "MEMORY",
  "CODE_MAP",
] as const;

export type ContextFileKey = (typeof CONTEXT_FILE_KEYS)[number];

export function renderAllContextFiles(
  vars: ContextTemplateVars,
): Record<ContextFileKey, string> {
  return {
    SOUL: renderSoul(vars),
    OWNER: renderOwner(vars),
    BUSINESS: renderBusiness(vars),
    PLATFORM: renderPlatform(),
    PLAYBOOK: renderPlaybook(vars),
    RUNBOOK: renderRunbook(),
    MEMORY: renderMemory(vars),
    CODE_MAP: renderCodeMap(),
  };
}

export const BRAND_IDENTITY_KIT_SKILL_KEY = "brandkit";

export function renderBrandIdentityKitSkill(): string {
  return `---
name: brandkit
version: 1
worker: marketing
trigger: owner or Robin requests a brand kit, logo direction, or a starter
  visual identity for a business that doesn't have one yet
outputs: a small set of image-generation prompts + a written rationale,
  not finished brand assets — the marketing worker executes the prompts
  through whichever image-generation tool is configured for this deployment
---

# Brand Identity Kit

A skill for producing a first-pass visual identity for a business that has
none yet: a short strategy note, a small logo-concept set, and a starter
color/type direction — enough for the owner to react to, not a finished
brand system.

## Before generating anything
Pull BUSINESS.md. If \`## Brand starting point\` is still the "not
established yet" placeholder and the offer/audience sections are also
placeholders, stop and ask the owner for the offer and audience first —
a brand kit generated against an unfilled BUSINESS.md is guessing, and
guessed brand direction is worse than no brand direction.

## Strategy note (write this first, always)
Before any image prompt, write 3-5 sentences covering:
- What the business actually sells and to whom (pull from BUSINESS.md,
  don't re-derive it).
- One adjective pair that should NOT describe this brand (e.g. "not
  corporate, not childish") — a boundary is more useful than a mood board.
- Whether the category default look is something to lean into or
  deliberately avoid, and why.

## Logo concepts
Produce exactly 3 directions, each a different construction method so the
owner is choosing between genuinely different ideas, not three variations
on one idea:
1. **Wordmark-led** — the business name itself, typography doing the work.
2. **Mark + wordmark** — a small abstract or geometric mark paired with the
   name, mark simple enough to work at 16px.
3. **Literal-but-simplified** — a mark that references what the business
   actually does, reduced to its simplest recognizable form.

For each: one line naming the concept, one line on why it fits the
strategy note, and the actual image-generation prompt.

## Color and type starter
- Propose one primary color, one accent, and a neutral pair (not a full
  palette) — enough to style a first landing page, not a full brand book.
- Propose one typeface pairing (one for headings, one for body) with a
  one-line reason each. Default to widely-licensed, web-safe-adjacent
  choices unless the strategy note specifically calls for something more
  distinctive.

## Rules
- Never reuse a color/type/mark combination already generated for another
  business in this deployment — check \`agentSkills\`/\`agentContextFiles\`
  history for this business only; cross-business brand collisions are a
  tenancy bug, not a style choice.
- Never claim a generated logo concept is final or production-ready — it's
  a direction for the owner to react to. Say so explicitly in the output.
- If the owner rejects all 3 directions, don't regenerate blind — ask what
  specifically was wrong with each before spending more credits.
- Record the accepted direction back into BUSINESS.md's
  "Brand starting point" section once the owner picks one, so later work
  (storefront styling, marketing copy) stays consistent with it instead of
  re-deriving brand direction from scratch each time.

## Output prompt template
Use this shape for each of the 3 logo-concept image-generation prompts:

\`\`\`
A [construction method] logo for "[business name]", a [one-line offer].
Style: [adjective pair from the strategy note, and the boundary adjective
pair to avoid]. Composition: centered mark on a plain background, single
color, must remain legible at small sizes. No gradients, no photorealism,
no stock-icon clichés for the business's category.
\`\`\`

Fill in the bracketed fields from the strategy note above — don't ship the
template with the brackets still in it.
`;
}
