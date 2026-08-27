# Facelift backend integration audit for shopface

**Audit date:** August 25, 2026  
**Scope:** Read-only discovery and an implementation-ready adapter recommendation. This document does not change Facelift, shopface product behavior, deployment settings, billing, or email delivery.

## Executive decision

Keep **Facelift** as the system of record for its product workflows and product data. Keep **shopface/MadeThis** as the public marketing site, private-preview control plane, commercial/fulfillment boundary, and operator-facing coordination layer. Connect them only through a narrow, server-side adapter after Facelift source and deployment access is granted.

There is not enough accessible evidence to safely claim Facelift's stack, API/GraphQL routes, authentication, schema, environment-variable names, webhook contracts, CORS policy, or preview-expiry behavior. The access blocker is material: do not build against guessed endpoints or mint a parallel Facelift backend.

## 1. Access result

| Surface | Result | Evidence from this audit | Required read-only access |
| --- | --- | --- | --- |
| `https://github.com/Dean-Rough/facelift` | **Unavailable** | GitHub REST repository lookup returned `404` on August 25, 2026. Anonymous `git ls-remote` could not authenticate. GitHub intentionally returns `404` for private repositories that the caller cannot read. | Grant the existing worker/integration read-only GitHub App or collaborator access, or provide a sanitized read-only mirror. Do not send a token in chat or commit one to a repository. |
| `facelift-control` Vercel project | **Unavailable for audit** | No authenticated Vercel project metadata, deployment configuration, logs, domains, Git linkage, or environment-variable names are available in this workspace. | Add the integration identity as Vercel **Viewer**, or provide a read-only export containing deployment metadata and environment-variable *names only*. |
| shopface source | **Available** | This workspace contains the Next.js/Convex source and its environment template. | No additional access required. |

The previous `.agent/facelift-integration-map.md` records the same access constraint. This audit supersedes it as the task-specific implementation checklist; neither file asserts unverified Facelift behavior as fact.

## 2. Verified shopface baseline

### Stack and deployment

- **Frontend/control plane:** Next.js 15 App Router with React 19 and Tailwind. Package commands are defined in `package.json`.
- **Data and server workflows:** Convex. The schema is in `convex/schema.ts`; the HTTP router is in `convex/http.ts`.
- **Authentication:** `@convex-dev/auth` handles signed-in customer routes under `/app`; Convex trust configuration is in `convex/auth.config.ts`.
- **Operator/admin boundary:** `src/middleware.ts` separately protects `/admin(.*)` with a signed JWT accepted from a `token` query parameter and then stored as an HTTP-only, `SameSite=Lax` `admin_token` cookie scoped to `/admin` for one hour. This token must never be forwarded to Facelift.
- **Deployment ownership:** shopface is independently deployed from this repository. No deployment or configuration change is part of this audit.

### Existing API and data boundary

- The only verified non-auth Convex HTTP endpoint is `POST /api/fulfillment` in `convex/http.ts`. It verifies `X-Fulfillment-Signature` as an HMAC-SHA256 over the raw request body before updating a matching workspace plan.
- Existing dynamic records are `users`, `workspaces`, `workspaceMembers`, `invitations`, and `blogPosts` in `convex/schema.ts`. There is no existing Facelift table, external-account mapping, preview record, webhook receipt log, or adapter configuration record.
- `workspaces` has `platformProductId`, `checkoutUrl`, `plan`, and `subscriptionStatus`. These are shopface commercial metadata; they must not be re-purposed as Facelift identifiers.

### Existing configuration names

The checked-in `.env.example` contains `NEXT_PUBLIC_CONVEX_URL`, `CONVEX_DEPLOY_KEY`, `ADMIN_TOKEN_SECRET`, `NEXT_PUBLIC_PLATFORM_URL`, and `PLATFORM_FULFILLMENT_SECRET`. `CONVEX_SITE_URL` is also read by `convex/auth.config.ts`.

No Facelift configuration is currently present. Do not infer that a value exists because the name is suggested below.

## 3. Facelift discovery matrix — blocked until access is granted

| Required finding | Current status | Exact source to inspect once access exists | Integration decision it unlocks |
| --- | --- | --- | --- |
| Runtime/framework and package manager | Unverified | Root `package.json`, lockfile, application entry points, `README` | Adapter runtime, build/deploy compatibility. |
| Vercel deployment layout | Unverified | `vercel.json`, Vercel project settings, deployment history, domains | Production/preview routing and ownership. |
| REST, GraphQL, RPC, or server actions | Unverified | `src/app/api/**`, `pages/api/**`, GraphQL schema/server setup, route middleware | Exact upstream base URL, health endpoint, payload schemas, pagination, error semantics. |
| GraphQL endpoint/schema | Unverified | GraphQL server configuration and generated schema/introspection policy | Whether a typed GraphQL client is appropriate. Do not assume `/api/graphql` or `/graphql`. |
| Human and service authentication | Unverified | Auth provider setup, middleware, token verification, API-key/OAuth code | Safe service-to-service credential and approved operator handoff. |
| Product data model | Unverified | ORM/Convex/Prisma/SQL schema, migrations, model modules | Stable external identifiers and minimal read projection. |
| Configuration and secret names | Unverified | `.env.example`, validation/config module, Vercel environment-name inventory | Exact secure-secret setup without copying secret values. |
| Webhooks/callbacks | Unverified | Route handlers, signature verifier, event types, idempotency storage | Event destination, signature algorithm, retry/duplicate handling. |
| CORS and browser boundary | Unverified | Middleware, headers config, route handlers, Vercel config | Whether any browser-origin request is supported; default should remain server-only. |
| Preview lifecycle/expiry | Unverified | Preview/public-link models, cron jobs, scheduled functions, route guards | Whether Facelift can own expiry or shopface needs a derived lifecycle record. |

## 4. Security and CORS position

Until Facelift proves a different supported pattern, the adapter must be **server-to-server only**:

- Browser code must never receive a Facelift API key, shared secret, OAuth client secret, or raw upstream response.
- Do not create permissive CORS rules. shopface public pages, customer `/app` pages, and browsers on preview domains must not call Facelift directly.
- Do not share `admin_token`, Convex auth tokens, cookies, or user sessions between the two applications. Human access to Facelift remains Facelift's own login flow unless its source proves a deliberate, time-limited launch-token mechanism.
- If Facelift emits callbacks, require a documented signature, event ID, timestamp, event type/version, and idempotency/replay policy. Verify against the **raw** body before parsing; reject stale or duplicate events.
- Keep a strict allowlist of adapter operations. Never expose a generic proxy that accepts arbitrary upstream paths, headers, methods, or bodies.

## 5. Preview lifecycle and expiry assessment

Facelift's ability to create or expire previews is **unverified**. shopface's business requirement remains: previews are private, clearly unofficial, form-free, unindexed, human-reviewed, and removed after outreach expires.

Recommended ownership split after inspection:

1. **Facelift:** Retain any existing rendering/template/project records and native preview lifecycle only if it already supports a stable external ID plus expiry/deactivation.
2. **shopface:** Retain the outreach approval record and the source-of-truth expiry decision. It may keep a future minimal mapping such as `faceliftPreviewId`, `shopfacePreviewId`, `expiresAt`, `state`, `lastSyncedAt`, and a signed-event receipt ID.
3. **Adapter:** On approved expiry, call one confirmed Facelift deactivate/delete operation idempotently. If Facelift has no lifecycle API, shopface must not fake removal by merely hiding a link; create a separate, explicitly approved fallback plan with Facelift's owner.
4. **Visibility controls:** Noindex, unofficial labeling, no live forms, and an expiry-safe route must be enforced in the serving product, not only in shopface copy.

## 6. Recommended minimal adapter

Build this only after the discovery matrix is completed and a non-production Facelift credential exists.

### First slice: read-only connection status

- Add a server-only shopface integration module and a `GET /api/integrations/facelift/status` Next.js route handler.
- Restrict it through the existing `/admin` protection in `src/middleware.ts`; do not show it to public visitors or `/app` customers.
- Return only a safe shape such as `{ configured, reachable, checkedAt, upstreamVersion? }`. Never return endpoint URLs containing credentials, headers, raw error bodies, or upstream account data.
- The route may call only a confirmed Facelift health/version/read endpoint using a scoped non-production credential. If there is no safe health endpoint, report a configuration state rather than probing a write or unauthenticated route.

### Second slice: one approved read projection

- Add one fixed, typed operation such as an account or preview summary after Facelift identifies stable external IDs and field ownership.
- Use explicit mapping: `shopfaceWorkspaceId` remains a shopface ID; `faceliftAccountId`/`faceliftPreviewId` remain Facelift IDs. Do not overload `platformProductId`.
- Log only sanitized operational metadata if durable diagnostics are needed. Do not replicate product records or add a background synchronization engine.

### Third slice: one lifecycle command (separate approval)

- Support exactly one named idempotent command, preferably deactivating an approved expired preview.
- Require an operator approval record, a request/correlation ID, an idempotency key, and a fixed payload schema.
- Do not add account provisioning, cross-domain SSO, data migration, generic command forwarding, or automatic destructive expiry until the read-only slice is proven.

### Proposed environment names — not yet authoritative

Use names such as `FACELIFT_API_BASE_URL` and `FACELIFT_ADAPTER_CREDENTIAL` **only if Facelift does not already prescribe names or an OAuth/HMAC scheme**. They must be server-only secrets; neither gets a `NEXT_PUBLIC_` prefix. Separate preview/non-production credentials from production credentials and never copy Vercel secret values into source, documentation, or chat.

## 7. Webhook and notification requirements

- Do not add third-party email packages, providers, or email API keys. If a future approved workflow requires mail, a Next.js server route/action must call MadeThis's absolute `/site/notify` proxy with a raw-body HMAC signed by `PLATFORM_FULFILLMENT_SECRET` and a supported type such as `contact_inquiry`, `subscriber.added`, `purchase_receipt`, `password_reset`, or `agent_reply`.
- The existing `POST /api/fulfillment` handler in `convex/http.ts` remains the MadeThis commercial boundary. A future order-to-Facelift provisioning flow must consume a documented, idempotent fulfillment event; it must not invoke Facelift directly from the browser or payment UI.
- A Facelift callback receiver should be a new, narrowly scoped server endpoint only after Facelift supplies its verified event contract. It should enforce signature validation, timestamp freshness, replay protection, strict event validation, and durable idempotency before side effects.

## 8. Blocking questions for Facelift owner

1. Can read-only GitHub access be granted to `Dean-Rough/facelift`, and can Vercel Viewer access (or a read-only settings export) be provided for `facelift-control`?
2. What is the canonical non-production API base URL and health/read endpoint? Is it REST, GraphQL, RPC, or no public API?
3. What machine-auth mechanism is already supported: scoped API key, HMAC, OAuth client credentials, or another pattern?
4. Which immutable identifiers represent a customer/account and a private preview, and which product owns preview creation, deactivation, and deletion?
5. Are outbound webhooks supported? If yes, what signature, event IDs, timestamp tolerance, delivery retries, and event versions are used?
6. Where are CORS rules enforced, and is there any existing requirement for browser-origin access? (The recommended answer is no.)
7. Does the product already enforce noindex, unofficial labels, form suppression, expiry, and actual removal? If so, identify the code path and scheduler/cron responsible.

## 9. Implementation acceptance criteria

Before any adapter code is approved, an engineer must be able to cite the actual Facelift route/module and confirm all of the following:

- A non-production read-only request succeeds using a scoped server credential.
- shopface build and TypeScript checks pass with no product-code changes beyond the approved adapter slice.
- No Facelift credential, raw upstream payload, user session, or arbitrary proxy capability reaches the browser.
- The admin status route is inaccessible without the existing `/admin` JWT gate.
- The documented preview expiry path causes real serving-side removal/deactivation, not simply link hiding.
- A failure or rollback in shopface leaves Facelift's product availability and data intact.

## Conclusion

The appropriate current action is access enablement, not implementation. Once the exact Facelift files/routes above are available, update this audit with verified endpoints, auth scheme, configuration names, lifecycle support, and deployment ownership before creating the read-only status adapter. Until then, the safest integration boundary is a planned, server-only, allowlisted bridge owned by shopface/MadeThis and isolated from Facelift's product runtime.
