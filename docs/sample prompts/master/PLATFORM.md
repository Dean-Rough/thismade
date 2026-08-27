# PLATFORM — Platform Integration Reference

This file documents how the business integrates with the MadeThis platform for checkout, payments, and auth. Workers should follow these patterns exactly.

## Checkout & Payments (Stripe Connect)

All payments are processed through **platform-hosted Stripe Checkout**. The business has a Stripe Connect account managed by the platform.

### Checkout Flow
1. Customer clicks a checkout link on the business storefront
2. Platform HTTP endpoint (`https://madethis.com/checkout/shopface/{productId}`) redirects to Stripe Checkout
3. Stripe processes payment on the business's Connect account
4. Platform automatically deducts the application fee
5. Stripe webhook fires → platform records the order in the `orders` table
6. Customer is redirected to the business site at `/checkout/success?session_id=...` — **you must build this page**

### Checkout URL Pattern
```
https://madethis.com/checkout/shopface/{productId}
```
Use the `get_checkout_url` tool to get the full URL for a specific product.

### Order Lookup
After checkout, the success page fetches order details from:
```
GET https://grandiose-goshawk-617.convex.site/checkout/order?session_id={stripeCheckoutSessionId}
```
Returns: business name, product name, amount, currency, masked customer email.

### Building Storefront Checkout
When dispatching tasks to build or update storefront pages with buy/checkout buttons:
- Link buttons to the platform checkout URL (from `get_checkout_url`)
- **NEVER** install `stripe` package or add Stripe API keys to business projects
- **NEVER** create custom payment forms — always redirect to platform checkout
- Optional: pass `success_url` and `cancel_url` query params (must be on `*.madethis.app` or `*.madethis.ai`) to override default redirect targets

### Post-Purchase Success Page
After payment, customers are redirected to **your business site** at `/checkout/success?session_id={CHECKOUT_SESSION_ID}`. You **must** build this page in your business project.

The success page should:
1. Read the `session_id` query parameter using `useSearchParams()` — **this hook MUST be in a component wrapped with `<Suspense>`** (Next.js requirement for prerendering). Extract a separate inner component for the search-params logic and wrap it in `<Suspense fallback={...}>` in the page's default export.
2. Fetch order details from the platform API: `GET https://grandiose-goshawk-617.convex.site/checkout/order?session_id={session_id}`
3. Display a confirmation message with the customer's purchase details
4. **For digital downloads**: provide a download link or access instructions for the purchased product
5. **For subscriptions**: show account setup or next-steps information

If the business sells digital products (ebooks, playbooks, courses, etc.), the success page is where customers get their download. Build this as a priority when setting up checkout.

Similarly, `/checkout/canceled` is where customers land if they abandon checkout — build a simple page that lets them return to the store.

### Webhook Events
The platform handles these Stripe webhook events automatically:
- `checkout.session.completed` — records the order (idempotent by session ID)
- Orders are stored with: businessId, productId, amount, currency, customer email, fulfillment status

## Customer Authentication (@convex-dev/auth)

Templates use `@convex-dev/auth` with the **Password** provider for customer sign-up and sign-in. Auth keys are auto-generated during provisioning — zero manual config.

### How it works
- RSA keypair generated at provisioning → `JWT_PRIVATE_KEY` and `JWKS` env vars set on the template's Convex deployment
- `SITE_URL` set to the business subdomain (e.g. `https://{slug}.madethis.app`)
- Auth emails (password reset) go through the platform proxy — templates POST to `PLATFORM_AUTH_EMAIL_URL` with an HMAC-SHA256 signature using `PLATFORM_FULFILLMENT_SECRET`
- Password-only initially — no OAuth providers configured

### Frontend hooks
- `useAuthActions()` from `@convex-dev/auth/react` — `signIn`, `signOut`
- `useConvexAuth()` from `convex/react` — `isAuthenticated`, `isLoading`

### Backend auth
- `getAuthUserId(ctx)` from `@convex-dev/auth/server` — returns the authenticated user ID
- `auth.getUserIdentity()` — returns identity claims (name, email, etc.)

### Rules
- **NEVER modify auth config or add OAuth providers** in business project code — auth is provisioned by the platform
- Templates come pre-wired with `@convex-dev/auth` — the agent only needs to use the hooks above
- For auth-gated pages, check `isAuthenticated` in components or `getAuthUserId(ctx)` in Convex functions
- Sign-in and sign-up forms use email + password fields — no social OAuth buttons
- **NEVER add Resend API keys to business projects** — auth emails use the platform proxy

## Deployment

- No subdomain configured yet — deployment URL will be available after setup

## "Built with MadeThis" Badge

All deployed sites **MUST** include a "Built with MadeThis" badge in the footer. This is a platform requirement for trial and starter plans.

### Badge HTML
Add this to the site's footer component (typically `footer.tsx`, `Footer.tsx`, or the main layout). Place it at the very bottom of the footer, centered.

```html
<div style="text-align: center; padding: 12px 0 8px; opacity: 0.5; font-size: 12px; font-family: system-ui, -apple-system, sans-serif;">
  <a href="https://madethis.com/r/gthd2hpc" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: none; display: inline-flex; align-items: center; gap: 4px;">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    Built with MadeThis
  </a>
</div>
```

### For Tailwind/React projects (preferred)
```tsx
<div className="text-center py-3 pb-2 opacity-50 text-xs">
  <a
    href="https://madethis.com/r/gthd2hpc"
    target="_blank"
    rel="noopener noreferrer"
    className="text-current no-underline inline-flex items-center gap-1 hover:opacity-75 transition-opacity"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>
    Built with MadeThis
  </a>
</div>
```

### Rules
- **Always include** the badge in the footer of every page layout
- The badge links to `https://madethis.com/r/gthd2hpc` (owner's referral link for attribution)
- Keep it subtle — muted opacity, small text, at the very bottom
- Do NOT remove the badge — it is required for trial and starter plan sites

## Platform Rules Summary

1. **No Stripe in business repos** — all payments go through platform checkout URLs
2. **No auth key management in business repos** — auth keys are provisioned by the platform
3. **Products are managed via CEO tools** — `create_product`, `update_product`, `list_products`
4. **Checkout URLs come from `get_checkout_url`** — never hardcode them
5. **Environment variables are set by the platform** — never ask workers to manually set CONVEX_DEPLOY_KEY, Stripe keys, or auth keys
6. **Vercel deploys automatically** — just push to `main`, no need to run `deploy_vercel` manually
