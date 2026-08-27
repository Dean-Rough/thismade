# Facelift → shopface operating-layer integration map

**Status:** discovery complete for shopface; Facelift source and Vercel project internals are not accessible in this worker as of **August 25, 2026**. This is an implementation plan, not a migration plan. No product code, deployment configuration, payment flow, or email provider is changed by this document.

## 0. Access result and minimum connection route

| Surface | Result | Evidence | Minimum non-secret connection route |
| --- | --- | --- | --- |
| `github.com/Dean-Rough/facelift` | **Unavailable** | The repository URL and GitHub API both return `404`; `git ls-remote` cannot authenticate in this worker. | Grant the existing worker/integration a read-only GitHub collaborator or GitHub App installation on the repository, or make a sanitized read-only mirror accessible. The route must permit clone/fetch and pull-request metadata; do not send a personal access token in chat or commit one to source. |
| Vercel project `dean-roughs-projects/facelift-control` | **Project shell reachable; project data unavailable** | The public URL responds, but its rendered content only links to Vercel sign-in. Deployment settings, domains, Git linkage, environment-variable names, logs, and deployment history are not visible. | Add the existing MadeThis integration identity as a Vercel **Viewer** to the team/project for the audit; elevate only to the smallest role required for a future approved deployment. A project export containing deployment metadata and environment-variable *names* is an acceptable read-only alternative. |
| shopface repository | **Available** | This workspace is the `Made-This/biz-shopface-jqyz` Next.js/Convex application. | No additional route needed for this document. |

Until both Facelift surfaces are readable, claims about its framework, routes, authentication, database, API, and deployment ownership must be treated as **unverified**. Do not infer them from the project name or create compatibility code against guessed endpoints.

## 1. Current architecture and system-of-record boundaries

### Verified shopface operating layer

| Area | Observed implementation | Owner / system of record |
| --- | --- | --- |
| Public marketing | Next.js 15 App Router pages at `/`, `/pricing`, `/about`, and `/blog`; the public surface already carries shopface brand assets and the Website + Care offer. | **shopface source** for public copy and presentation. |
| Customer app | Authenticated `/app` workspace, team, and billing screens. | **shopface Convex** for its own account/workspace metadata. |
| Authentication | `@convex-dev/auth` password flow protects `/app`. `/admin` uses a separately verified JWT placed in an `admin_token` HTTP-only cookie by middleware. | **shopface auth** for shopface users; do not assume it can mint a Facelift session. |
| Operational control plane | `/admin` exposes workspace/user lists, workspace statistics, blog management, and settings navigation. | **shopface** for the current administrative data only. |
| Persistence | Convex tables cover users, workspaces, memberships, invitations, and blog posts. Workspaces currently store plan, platform product ID, hosted checkout URL, and subscription state. | **shopface Convex** for those records. |
| Billing handoff | Browser opens a stored `checkoutUrl`; incoming Convex HTTP endpoint `/api/fulfillment` validates `X-Fulfillment-Signature` and updates the matching workspace by `platformProductId`. | **MadeThis hosted checkout / fulfillment** for payment; **shopface Convex** for the mirrored subscription state. |
| Email | No outbound mail integration is currently implemented in source. | Future storefront mail must use the MadeThis `/site/notify` proxy from a server-only route/action. |

### Facelift product system of record

**Target boundary:** the existing Facelift frontend and backend remain authoritative for Facelift product accounts, product-domain objects, product permissions, product workflows, and product history. shopface must not recreate those tables or write to its datastore directly.

This boundary is a recommendation pending source review. The actual Facelift stack, persistence layer, API surface, user model, and existing admin tooling are unknown until the read-only access route above is supplied.

## 2. Recommended target architecture

Keep the systems independently deployable and connect them through a narrow, server-side adapter:

```text
visitor / prospect
       │
       ├── shopface public site ──> MadeThis hosted checkout
       │                                  │
       │                                  └── signed fulfillment event
       │                                           │
MadeThis operators ──> shopface control plane ───> Facelift adapter/BFF ───> Facelift API
       │                         │                         │
       │                         └── MadeThis /site/notify  └── Facelift system of record
       │
       └── approval/outreach records in shopface Convex
```

### Adapter/BFF responsibilities

Implement the adapter inside shopface only after the Facelift API is inspected. It should be a server-only Next.js route handler/action (or a Convex Node action if it needs to coordinate Convex records) and must:

1. authenticate shopface operator/admin context before every request;
2. use a short, allowlisted set of Facelift operations rather than proxying arbitrary paths;
3. authenticate to Facelift with a dedicated machine-to-machine credential, never a browser token;
4. validate response schemas and map stable external IDs to shopface integration records;
5. make write operations idempotent with a request/event ID and retain an audit outcome;
6. redact tokens and personal data from logs; and
7. never expose a Facelift base URL or credential to browser code.

The BFF is **not** a replacement Facelift API and is not a data-sync engine. shopface owns outreach, approval, checkout handoff, and operational notes; Facelift owns product state.

## 3. Integration contracts and data ownership

The endpoint names below are proposed adapter contracts, not verified Facelift endpoints. Confirm Facelift's actual API version, identifiers, rate limits, pagination, error model, and idempotency behavior before implementation.

| Contract | Direction | Purpose | Authoritative data | Safety rule |
| --- | --- | --- | --- | --- |
| `GET /api/integrations/facelift/status` | shopface admin → adapter | Report configured/unconfigured state and a sanitized health result. | Facelift for health; shopface for connection audit metadata. | No credentials or response bodies in browser output. |
| `GET /api/integrations/facelift/accounts/{faceliftAccountId}` | shopface admin → adapter → Facelift | Read a product-account summary for an approved operational task. | Facelift. | Read-only, allowlisted fields, operator authorization required. |
| `POST /api/integrations/facelift/commands` | shopface admin → adapter → Facelift | Carry an approved, named command such as linking an accepted customer. | Facelift for result; shopface for request/approval/audit record. | Versioned command enum, strict payload schema, idempotency key, no arbitrary URL/body forwarding. |
| `POST /api/integrations/facelift/events` | Facelift → shopface | Deliver signed lifecycle events needed by operations, such as a provisioning result. | Facelift event payload; shopface event receipt and derived operational state. | HMAC signature, timestamp/replay window, idempotency/event ID, acknowledgement only after durable receipt. |
| `POST {PLATFORM_AUTH_EMAIL_URL with /auth/send-email replaced by /site/notify}` | shopface server → MadeThis | Send contact/approval/outreach messages using supported types only. | shopface operational record; MadeThis delivery proxy. | HMAC `X-Site-Notify-Signature`; valid types only: `contact_inquiry`, `subscriber.added`, `purchase_receipt`, `password_reset`, `agent_reply`. |

### IDs and ownership

- Store a dedicated `faceliftAccountId`/`faceliftEntityId` only after Facelift confirms stable external identifiers. Do not overload a Convex document ID, Vercel deployment ID, checkout URL, product ID, or email address as a cross-system primary key.
- Continue to treat `platformProductId`, `checkoutUrl`, and subscription state in shopface workspaces as the checkout/entitlement handoff data that is already modeled there. Do not make Facelift the billing source merely because it receives provisioning information.
- Shopface should add only narrow integration metadata when approved: external ID, integration state, last successful sync/event timestamps, and an immutable event/command audit reference. It should not copy Facelift product records.
- Use MadeThis hosted checkout links only. Do not introduce Stripe SDKs, Stripe keys, or a custom payment API.

## 4. Auth, sessions, and event boundaries

### Human sessions

- shopface customers continue to use `@convex-dev/auth` for `/app`; shopface operators use the existing signed admin-link/JWT-cookie pattern for `/admin`.
- Facelift user sessions remain on Facelift. Do not share `admin_token`, Convex auth tokens, or browser cookies with Facelift, and do not attempt silent cross-domain session sharing.
- If an operator needs to open Facelift, use an explicit link/session handoff approved by Facelift's existing auth model. Prefer a time-limited, one-time signed launch token only if Facelift supports it; otherwise require normal Facelift sign-in.

### Machine calls and webhooks

- The adapter authenticates to Facelift server-to-server using a scoped integration credential accepted by Facelift; select the exact scheme only after inspection (for example, HMAC request signing or OAuth client credentials if already supported).
- Facelift-to-shopface callbacks must include an event ID, issued timestamp, event type/version, and a cryptographic signature. shopface must reject invalid signatures and stale/replayed events, persist the receipt idempotently, then process it.
- MadeThis fulfillment already enters shopface through Convex `/api/fulfillment` with `X-Fulfillment-Signature`. Preserve that boundary; any future mapping from paid order to Facelift provisioning must occur only after a documented, idempotent fulfillment event.
- Outbound email never calls an email provider. A server-side route/action calls the MadeThis absolute `/site/notify` proxy with its signed raw JSON body and an allowed event type.

## 5. Vercel deployment and environment ownership

| Surface | Production ownership | Preview approach | Constraint |
| --- | --- | --- | --- |
| Facelift product/frontend/backend | Dean's existing Facelift repository and `facelift-control` Vercel project. | Keep existing Vercel preview branches and production aliases unchanged until a separate approved change. | No replacement, migration, redeploy, or environment mutation in this task. |
| shopface public/operations app | This shopface repository and its existing MadeThis-managed deployment. | Use a shopface branch preview for adapter/control-plane changes, configured with preview-safe integration endpoints. | Do not point previews at production write endpoints. |
| MadeThis checkout/notification layer | MadeThis managed platform. | Use platform-supported test/preview fixtures only when available; never add Stripe or mail-provider credentials. | Checkout and mail remain platform handoffs, not shopface-owned infrastructure. |

Use separate non-production Facelift credentials and callback endpoints for shopface preview deployments. Production adapter secrets belong only in MadeThis secure secret storage for the production shopface runtime; do not copy Vercel env values between projects.

## 6. Required configuration names and runtimes

Values are deliberately omitted. Store all secret values in MadeThis/Vercel/Convex secure environment storage for the relevant runtime; never in chat, Git, client bundles, or `.env.example` values.

| Name | Runtime | Status / purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_CONVEX_URL` | shopface browser and server | Existing public Convex endpoint. |
| `CONVEX_DEPLOY_KEY` | build/deployment only | Existing shopface deployment configuration. |
| `CONVEX_SITE_URL` | Convex auth configuration | Existing Convex Auth issuer/trust configuration. |
| `ADMIN_TOKEN_SECRET` | shopface Next.js middleware/server | Existing admin JWT verification secret. |
| `NEXT_PUBLIC_PLATFORM_URL` | shopface browser | Existing public platform URL. |
| `PLATFORM_FULFILLMENT_SECRET` | shopface Convex HTTP action / server notification signer | Existing fulfillment verification secret; use the appropriate secure runtime only. |
| `PLATFORM_AUTH_EMAIL_URL` | shopface server only | Required before a server route/action can derive the MadeThis `/site/notify` absolute URL. |
| `FACELIFT_API_BASE_URL` | shopface server only | **Proposed:** Facelift server origin used by the adapter; never `NEXT_PUBLIC_`. |
| `FACELIFT_ADAPTER_SHARED_SECRET` | shopface server and Facelift server | **Proposed:** scoped machine-to-machine adapter credential; final name/scheme must match Facelift support. |
| `FACELIFT_WEBHOOK_SIGNING_SECRET` | shopface server/Convex webhook verifier and Facelift event producer | **Proposed:** verifies Facelift-to-shopface event signatures. |

If Facelift already has an established integration secret or OAuth client registration, preserve its names and ownership instead of adding parallel credentials. The source audit must decide this.

## 7. Phased rollout, risks, and rollback points

1. **Read-only discovery (current):** obtain read access, inventory Facelift code and Vercel configuration, and reconcile actual interfaces with this map. **Rollback:** none; documentation only.
2. **Connection proof:** add a server-only, read-only adapter health/status check in a shopface preview, using a non-production Facelift environment. **Risk:** accidental disclosure of health payload/secret. **Rollback:** remove the preview route and revoke only the scoped preview credential.
3. **Operator visibility:** add an integration status/audit view to shopface admin with no product writes. **Risk:** misleading stale state. **Rollback:** hide the view; Facelift remains untouched.
4. **One idempotent command:** implement one approved link/provision action behind an explicit operator approval record and signed Facelift call. **Risk:** duplicate provisioning or mismatched identity. **Rollback:** disable the command feature flag, stop the adapter, and use Facelift's existing admin control path; retain audit events for reconciliation.
5. **Signed lifecycle events:** accept a minimal Facelift event set and show derived operational state in shopface. **Risk:** event replay/order loss. **Rollback:** pause event consumption, retain raw receipts, and reconcile manually against Facelift.
6. **Operational expansion:** add approved outreach, maintenance, and customer lifecycle workflows one bounded event/command at a time. **Risk:** scope creep into a duplicate product backend. **Rollback:** keep each integration capability independently disableable; product behavior remains in Facelift.

At every phase, preserve Facelift production deployment and datastore unchanged. Never make a cutover dependent on a shopface deploy. A failure in shopface must degrade to its control-plane record being unavailable, not to Facelift product availability.

## 8. Recommended first implementation slice — separate approval required

**Title:** `feat: add read-only Facelift adapter health check for shopface admin preview`

**Scope after access is granted:**

1. Inspect Facelift's actual health/auth API and confirm a non-production endpoint plus one scoped server credential.
2. Add a server-only shopface integration module and `GET /api/integrations/facelift/status` route, returning only `configured`, `reachable`, timestamp, and a sanitized version/correlation ID.
3. Add a small admin-only integration status surface using the existing `/admin` JWT gate; do not expose it to `/app` customers or public visitors.
4. Add a minimal integration audit record/query only if the confirmed Facelift response needs durable status. Do not import or sync Facelift product data.
5. Configure only preview-safe secret values in secure storage, run build/type checks, and verify the preview status response without invoking product writes.

**Explicitly out of scope:** migration, Facelift UI changes, product-database access, account provisioning, cross-domain SSO, checkout changes, Stripe, email SDKs/provider keys, outreach sends, webhook receivers, or any deployment to `facelift-control`.

**Approval gate:** approve only after the read-only GitHub/Vercel audit confirms the actual API/auth contract and names the responsible Facelift deployment owner.
